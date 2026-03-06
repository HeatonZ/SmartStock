const { createApp, computed, onMounted, reactive, ref } = Vue;

const API_BASE = 'http://localhost:8000';
const DEMO_ITEMS = [
  {
    productId: 'demo-1',
    sku: 'SKU-DEMO-001',
    name: 'Demo Product A',
    safetyStock: 30,
    availableQty: 42,
    version: 1,
  },
  {
    productId: 'demo-2',
    sku: 'SKU-DEMO-002',
    name: 'Demo Product B',
    safetyStock: 20,
    availableQty: 12,
    version: 3,
  },
];
const DEMO_SUGGESTION = {
  sku: 'SKU-DEMO-002',
  name: 'Demo Product B',
  suggestedQty: 24,
  reason: '演示数据：当前库存接近安全库存，建议及时补货。',
};
const DEMO_ADMINS = [
  { id: 'admin-1', email: 'admin@smartstock.local', role: 'admin', isActive: true, isLoggedIn: true },
  { id: 'admin-2', email: 'ops1@smartstock.local', role: 'admin', isActive: true, isLoggedIn: false },
  { id: 'admin-3', email: 'ops2@smartstock.local', role: 'admin', isActive: true, isLoggedIn: false },
];
const DEMO_LOGS = [
  {
    id: 1,
    createdAt: new Date().toISOString(),
    opType: 'ADJUST',
    deltaQty: 5,
    beforeQty: 37,
    afterQty: 42,
    reason: 'manual-increase',
    sku: 'SKU-DEMO-001',
    name: 'Demo Product A',
    adminEmail: 'admin@smartstock.local',
  },
  {
    id: 2,
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    opType: 'DEDUCT',
    deltaQty: -5,
    beforeQty: 17,
    afterQty: 12,
    reason: 'order DEMO-ORDER-1',
    sku: 'SKU-DEMO-002',
    name: 'Demo Product B',
    adminEmail: 'ops1@smartstock.local',
  },
];

createApp({
  setup() {
    const token = ref(localStorage.getItem('smartstock_token') || '');
    const form = reactive({ email: 'admin@smartstock.local', password: 'admin123456' });
    const loading = ref(false);
    const dashboard = ref([]);
    const suggestion = ref(null);
    const suggestionLoading = ref(false);
    const admins = ref([]);
    const inventoryLogs = ref([]);
    const logsPage = ref(1);
    const logsPageSize = ref(10);
    const logsTotal = ref(0);
    const logsTotalPages = ref(1);
    const wsStatus = ref('disconnected');
    const message = ref('');
    const isOfflineDemo = ref(false);
    const mode = ref('offline');

    let socket = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let heartbeatTimer = null;
    let heartbeatTimeoutTimer = null;
    let logsRefreshTimer = null;
    let logsRefreshInFlight = false;
    let logsRefreshQueued = false;
    let manualClose = false;

    const HEARTBEAT_INTERVAL_MS = 10_000;
    const HEARTBEAT_TIMEOUT_MS = 15_000;
    const MAX_RECONNECT_DELAY_MS = 10_000;
    const LOGS_REFRESH_DEBOUNCE_MS = 600;

    const authHeader = computed(() => ({ Authorization: `Bearer ${token.value}` }));

    function enableOfflineDemo() {
      mode.value = 'offline';
      isOfflineDemo.value = true;
      wsStatus.value = 'offline-demo';
      dashboard.value = DEMO_ITEMS.map((item) => ({ ...item }));
      suggestion.value = { ...DEMO_SUGGESTION };
      admins.value = DEMO_ADMINS.map((item) => ({ ...item }));
      inventoryLogs.value = DEMO_LOGS.map((item) => ({ ...item }));
      logsPage.value = 1;
      logsPageSize.value = 10;
      logsTotal.value = DEMO_LOGS.length;
      logsTotalPages.value = 1;
      if (!message.value) {
        message.value = '后端未启动，当前为离线演示模式。';
      }
    }

    async function _switchMode(targetMode) {
      if (targetMode === 'offline') {
        manualClose = true;
        clearReconnectTimer();
        clearHeartbeatTimers();
        if (socket) {
          socket.close();
          socket = null;
        }
        enableOfflineDemo();
        return;
      }

      mode.value = 'online';
      isOfflineDemo.value = false;
      wsStatus.value = 'disconnected';
      message.value = '';
      manualClose = false;

      if (token.value) {
        await refreshAll();
        if (!isOfflineDemo.value) {
          connectWs();
        }
      }
    }

    function clearHeartbeatTimers() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (heartbeatTimeoutTimer) {
        clearTimeout(heartbeatTimeoutTimer);
        heartbeatTimeoutTimer = null;
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function clearLogsRefreshTimer() {
      if (logsRefreshTimer) {
        clearTimeout(logsRefreshTimer);
        logsRefreshTimer = null;
      }
    }

    function scheduleReconnect() {
      if (manualClose || !token.value || reconnectTimer) {
        return;
      }

      const delay = Math.min(1000 * (2 ** reconnectAttempts), MAX_RECONNECT_DELAY_MS);
      reconnectAttempts += 1;
      wsStatus.value = `reconnecting(${Math.ceil(delay / 1000)}s)`;

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, delay);
    }

    function startHeartbeat() {
      clearHeartbeatTimers();
      heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(JSON.stringify({ type: 'ws.ping', ts: new Date().toISOString() }));
        if (heartbeatTimeoutTimer) {
          clearTimeout(heartbeatTimeoutTimer);
        }

        heartbeatTimeoutTimer = setTimeout(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close(4000, 'Heartbeat timeout');
          }
        }, HEARTBEAT_TIMEOUT_MS);
      }, HEARTBEAT_INTERVAL_MS);
    }

    async function login() {
      loading.value = true;
      message.value = '';
      mode.value = 'online';
      isOfflineDemo.value = false;
      try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '登录失败');
        }
        token.value = data.token;
        localStorage.setItem('smartstock_token', token.value);
        await refreshAll();
        reconnectAttempts = 0;
        manualClose = false;
        connectWs();
      } catch (error) {
        message.value = error.message;
      } finally {
        loading.value = false;
      }
    }

    function logout() {
      token.value = '';
      manualClose = true;
      localStorage.removeItem('smartstock_token');
      dashboard.value = [];
      suggestion.value = null;
      admins.value = [];
      inventoryLogs.value = [];
      logsPage.value = 1;
      logsTotal.value = 0;
      logsTotalPages.value = 1;
      clearReconnectTimer();
      clearHeartbeatTimers();
      clearLogsRefreshTimer();
      logsRefreshInFlight = false;
      logsRefreshQueued = false;
      if (socket) {
        socket.close();
        socket = null;
      }
      wsStatus.value = 'disconnected';
    }

    async function fetchDashboard() {
      const response = await fetch(`${API_BASE}/api/inventory/dashboard`, { headers: authHeader.value });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '获取库存失败');
      }
      mode.value = 'online';
      isOfflineDemo.value = false;
      dashboard.value = data.items;
    }

    async function fetchAdmins() {
      const response = await fetch(`${API_BASE}/api/admins`, { headers: authHeader.value });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '获取管理员列表失败');
      }
      mode.value = 'online';
      isOfflineDemo.value = false;
      admins.value = data.items;
    }

    async function fetchInventoryLogs(page = logsPage.value) {
      const response = await fetch(
        `${API_BASE}/api/inventory/logs?page=${page}&pageSize=${logsPageSize.value}`,
        { headers: authHeader.value },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '获取库存变动详情失败');
      }
      mode.value = 'online';
      isOfflineDemo.value = false;
      inventoryLogs.value = data.items;
      logsPage.value = data.page ?? page;
      logsPageSize.value = data.pageSize ?? logsPageSize.value;
      logsTotal.value = data.total ?? 0;
      logsTotalPages.value = data.totalPages ?? 1;
    }

    async function changeLogsPage(targetPage) {
      const nextPage = Math.max(1, Math.min(targetPage, logsTotalPages.value || 1));
      if (nextPage === logsPage.value && inventoryLogs.value.length > 0) {
        return;
      }
      if (isOfflineDemo.value) {
        logsPage.value = 1;
        return;
      }
      await fetchInventoryLogs(nextPage);
    }

    function scheduleLogsRefresh() {
      if (isOfflineDemo.value || !token.value) {
        return;
      }

      if (logsRefreshInFlight) {
        logsRefreshQueued = true;
        return;
      }

      clearLogsRefreshTimer();
      logsRefreshTimer = setTimeout(() => {
        logsRefreshTimer = null;
        logsRefreshInFlight = true;
        fetchInventoryLogs(logsPage.value).catch(() => {
          // ignore temporary logs refresh errors
        }).finally(() => {
          logsRefreshInFlight = false;
          if (logsRefreshQueued) {
            logsRefreshQueued = false;
            scheduleLogsRefresh();
          }
        });
      }, LOGS_REFRESH_DEBOUNCE_MS);
    }

    async function refreshAll() {
      try {
        await Promise.all([fetchDashboard(), fetchAdmins(), fetchInventoryLogs()]);
        message.value = '';
      } catch (error) {
        if (!token.value || mode.value === 'offline') {
          enableOfflineDemo();
        } else {
          isOfflineDemo.value = false;
          wsStatus.value = 'error';
          message.value = (error && error.message)
            ? `在线模式请求失败：${error.message}`
            : '在线模式请求失败，请检查后端连接';
        }
      }
    }

    async function adjust(productId, delta, reason) {
      if (isOfflineDemo.value) {
        const target = dashboard.value.find((row) => row.productId === productId);
        if (!target) return;
        target.availableQty += delta;
        target.version += 1;
        return;
      }

      const response = await fetch(`${API_BASE}/api/inventory/adjust`, {
        method: 'POST',
        headers: {
          ...authHeader.value,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId, delta, reason }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || '调整失败');
      }
    }

    async function simulateDeduct(productId) {
      if (isOfflineDemo.value) {
        const target = dashboard.value.find((row) => row.productId === productId);
        if (!target) return;
        target.availableQty = Math.max(0, target.availableQty - 5);
        target.version += 1;
        alert('离线演示模式：已模拟扣减 5');
        return;
      }

      const clients = Number(prompt('模拟并发客户端数量', '20'));
      const quantityPerClient = Number(prompt('每个客户端扣减数量', '5'));
      if (!clients || !quantityPerClient) {
        return;
      }

      const response = await fetch(`${API_BASE}/api/orders/simulate`, {
        method: 'POST',
        headers: {
          ...authHeader.value,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId, clients, quantityPerClient }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || '模拟失败');
        return;
      }
      alert(`完成：成功 ${data.success}，失败 ${data.failed}`);
      await Promise.all([fetchDashboard(), fetchInventoryLogs()]);
    }

    async function generateSuggestion() {
      if (isOfflineDemo.value) {
        suggestion.value = { ...DEMO_SUGGESTION };
        alert('离线演示模式：已展示示例补货建议。');
        return;
      }

      suggestionLoading.value = true;
      try {
        const response = await fetch(`${API_BASE}/api/ai/restock-suggestions/generate`, {
          method: 'POST',
          headers: authHeader.value,
        });
        const data = await response.json();
        if (!response.ok) {
          alert(data.error || '生成建议失败');
          return;
        }
        suggestion.value = data.suggestion ?? null;
      } finally {
        suggestionLoading.value = false;
      }
    }

    function applyRealtimeUpdate(event) {
      if (event.type !== 'inventory.changed') {
        return;
      }
      const target = dashboard.value.find((row) => row.productId === event.payload.productId);
      if (target) {
        target.availableQty = event.payload.availableQty;
        target.version = event.version;
      }
      scheduleLogsRefresh();
    }

    function connectWs() {
      if (!token.value) return;
      if (isOfflineDemo.value) return;
      clearReconnectTimer();

      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }

      const wsUrl = `ws://localhost:8000/ws?token=${encodeURIComponent(token.value)}`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        wsStatus.value = 'connected';
        reconnectAttempts = 0;
        startHeartbeat();
        fetchAdmins().catch(() => {
          // ignore admins refresh failure on websocket open
        });
      };
      socket.onclose = () => {
        clearHeartbeatTimers();
        wsStatus.value = 'disconnected';
        if (!manualClose) {
          scheduleReconnect();
        }
      };
      socket.onerror = () => {
        wsStatus.value = 'error';
      };
      socket.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data);
          if (payload.type === 'ws.pong') {
            if (heartbeatTimeoutTimer) {
              clearTimeout(heartbeatTimeoutTimer);
              heartbeatTimeoutTimer = null;
            }
            return;
          }
          if (payload.type === 'ws.ping') {
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ws.pong', ts: new Date().toISOString() }));
            }
            return;
          }
          applyRealtimeUpdate(payload);
        } catch {
          // ignore
        }
      };
    }

    onMounted(async () => {
      if (token.value) {
        mode.value = 'online';
        isOfflineDemo.value = false;
        manualClose = false;
        await refreshAll();
        if (!isOfflineDemo.value) {
          connectWs();
        }
      } else {
        await _switchMode('offline');
      }
    });

    return {
      token,
      form,
      loading,
      dashboard,
      suggestion,
      suggestionLoading,
      admins,
      inventoryLogs,
      logsPage,
      logsTotal,
      logsTotalPages,
      wsStatus,
      message,
      isOfflineDemo,
      mode,
      login,
      logout,
      switchMode: _switchMode,
      changeLogsPage,
      adjust,
      simulateDeduct,
      generateSuggestion,
      refreshAll,
    };
  },
  template: `
    <main class="container">
      <h1>智能仓储协同系统</h1>
      <div class="toolbar">
        <span>模式: {{ mode === 'offline' ? '离线演示' : '在线模式' }}</span>
        <div class="buttons">
          <button :disabled="mode === 'offline'" @click="switchMode('offline')">离线演示</button>
          <button :disabled="mode === 'online'" @click="switchMode('online')">在线模式</button>
        </div>
      </div>

      <section v-if="!token && !isOfflineDemo" class="card">
        <h2>管理员登录</h2>
        <div class="grid">
          <input v-model="form.email" placeholder="邮箱" />
          <input v-model="form.password" type="password" placeholder="密码" />
        </div>
        <button :disabled="loading" @click="login">{{ loading ? '登录中...' : '登录' }}</button>
        <p class="error" v-if="message">{{ message }}</p>
      </section>

      <section v-else>
        <div class="toolbar">
          <span>WS: {{ wsStatus }}</span>
          <div class="buttons">
            <button @click="refreshAll">刷新</button>
            <button :disabled="suggestionLoading" @click="generateSuggestion">{{ suggestionLoading ? '生成中...' : '生成补货建议' }}</button>
            <button @click="logout">退出</button>
          </div>
        </div>
        <p v-if="isOfflineDemo" class="offline">当前为离线演示模式（后端未连接）。</p>

        <div class="card">
          <h2>实时库存看板</h2>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>商品名</th>
                <th>当前库存</th>
                <th>安全库存</th>
                <th>版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in dashboard" :key="item.productId">
                <td>{{ item.sku }}</td>
                <td>{{ item.name }}</td>
                <td :class="{ low: item.availableQty <= item.safetyStock }">{{ item.availableQty }}</td>
                <td>{{ item.safetyStock }}</td>
                <td>{{ item.version }}</td>
                <td>
                  <button @click="adjust(item.productId, 1, 'manual-increase')">+1</button>
                  <button @click="adjust(item.productId, -1, 'manual-decrease')">-1</button>
                  <button @click="simulateDeduct(item.productId)">并发扣减模拟</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>补货建议（本次生成）</h2>
          <p v-if="!suggestion">点击“生成补货建议”后显示结果。</p>
          <p v-else>
            <strong>{{ suggestion.sku }}</strong>
            <span v-if="suggestion.name">（{{ suggestion.name }}）</span>
            ：建议补货 {{ suggestion.suggestedQty }}，原因：{{ suggestion.reason }}
          </p>
        </div>
        <div class="card">
          <h2>库存变动详情</h2>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>SKU</th>
                <th>商品</th>
                <th>类型</th>
                <th>变动</th>
                <th>变更前</th>
                <th>变更后</th>
                <th>操作人</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in inventoryLogs" :key="log.id">
                <td>{{ new Date(log.createdAt).toLocaleString() }}</td>
                <td>{{ log.sku }}</td>
                <td>{{ log.name }}</td>
                <td>{{ log.opType }}</td>
                <td :class="log.deltaQty < 0 ? 'deltaDown' : 'deltaUp'">{{ log.deltaQty }}</td>
                <td>{{ log.beforeQty }}</td>
                <td>{{ log.afterQty }}</td>
                <td>{{ log.adminEmail }}</td>
                <td>{{ log.reason || '-' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="pager">
            <span>共 {{ logsTotal }} 条，{{ logsPage }}/{{ logsTotalPages }} 页</span>
            <div class="buttons">
              <button :disabled="logsPage <= 1" @click="changeLogsPage(logsPage - 1)">上一页</button>
              <button :disabled="logsPage >= logsTotalPages" @click="changeLogsPage(logsPage + 1)">下一页</button>
            </div>
          </div>
        </div>
        <div class="card">
          <h2>管理员账号列表</h2>
          <table>
            <thead>
              <tr>
                <th>邮箱</th>
                <th>角色</th>
                <th>账号状态</th>
                <th>登录状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="admin in admins" :key="admin.id">
                <td>{{ admin.email }}</td>
                <td>{{ admin.role }}</td>
                <td>{{ admin.isActive ? '启用' : '禁用' }}</td>
                <td :class="admin.isLoggedIn ? 'online' : 'offlineText'">{{ admin.isLoggedIn ? '在线' : '离线' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `,
}).mount('#app');
