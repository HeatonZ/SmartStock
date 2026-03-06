import { Hono } from 'npm:hono@4.7.2';
import { cors } from 'npm:hono@4.7.2/cors';
import { upgradeWebSocket } from 'npm:hono@4.7.2/deno';
import { loadEnv, getConfig } from '@api/src/config.ts';
import { authRoutes } from '@api/src/routes/auth.ts';
import { inventoryRoutes } from '@api/src/routes/inventory.ts';
import { orderRoutes } from '@api/src/routes/orders.ts';
import { aiRoutes } from '@api/src/routes/ai.ts';
import { adminRoutes } from '@api/src/routes/admins.ts';
import { verifyJwt } from '@api/src/utils/jwt.ts';
import { realtimeHub } from '@api/src/services/realtime_hub.ts';
import { runStartupPreflight } from '@api/src/preflight.ts';

await loadEnv();
try {
  await runStartupPreflight();
  console.log('Startup preflight passed (config + PostgreSQL connectivity).');
} catch (error) {
  console.error('Startup preflight failed:', (error as Error).message);
  Deno.exit(1);
}

const app = new Hono();

app.use('*', cors({
  origin: ['http://localhost:5173'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ ok: true, service: 'smartstock-api' }));
app.route('/api/auth', authRoutes);
app.route('/api/inventory', inventoryRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/admins', adminRoutes);

app.get(
  '/ws',
  upgradeWebSocket(async (c) => {
    const token = c.req.query('token') ?? '';
    const payload = token ? await verifyJwt(token, getConfig().jwtSecret) : null;
    if (!payload) {
      return {
        onOpen: (event, ws) => {
          ws.close(1008, 'Unauthorized');
        },
      };
    }

    let lastHeartbeatAt = Date.now();
    let watchdogTimer: number | undefined;

    const cleanup = (ws: WebSocket) => {
      if (watchdogTimer !== undefined) {
        clearInterval(watchdogTimer);
        watchdogTimer = undefined;
      }
      realtimeHub.remove(ws);
    };

    return {
      onOpen: (_, ws) => {
        realtimeHub.add(ws, payload.sub);
        lastHeartbeatAt = Date.now();
        watchdogTimer = setInterval(() => {
          if (Date.now() - lastHeartbeatAt > 35_000) {
            ws.close(1001, 'Heartbeat timeout');
            return;
          }
          ws.send(JSON.stringify({ type: 'ws.ping', ts: new Date().toISOString() }));
        }, 15_000);
        ws.send(JSON.stringify({ type: 'ws.connected', ts: new Date().toISOString() }));
      },
      onClose: (_, ws) => {
        cleanup(ws);
      },
      onError: (_, ws) => {
        cleanup(ws);
      },
      onMessage: (event, ws) => {
        lastHeartbeatAt = Date.now();
        const data = typeof event.data === 'string' ? event.data : '';
        if (data === 'ping') {
          ws.send('pong');
          return;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'ws.ping') {
            ws.send(JSON.stringify({ type: 'ws.pong', ts: new Date().toISOString() }));
          }
        } catch {
          // ignore non-JSON heartbeat messages
        }
      },
    };
  }),
);

const config = getConfig();
console.log(`SmartStock API started on http://localhost:${config.apiPort}`);
Deno.serve({ port: config.apiPort }, app.fetch);
