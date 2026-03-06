# 智能仓储协同系统架构文档

## 1. 架构目标

系统用于跨境电商仓储协同原型，核心目标：

- 多管理员协同操作库存。
- 库存变更实时同步（无需刷新）。
- 高并发扣减场景下防止超卖。
- 基于近 7 天库存日志生成补货建议。
- 使用 PostgreSQL 做关系型持久化。

## 2. 技术栈与模块划分

### 2.1 技术栈

- 后端：Deno + Hono
- 前端：Vue3（独立前端）
- 数据库：PostgreSQL
- 实时通信：WebSocket
- AI：Provider 抽象层（可接 DeepSeek/Gemini/本地模型）

### 2.2 目录模块

- `apps/api`：业务 API、鉴权、库存服务、实时推送
- `apps/web`：库存看板、并发模拟、补货建议界面
- `packages/shared-types`：前后端共享类型
- `packages/ai-provider`：AI 适配层与默认回退实现
- `infra/db`：SQL schema 与 seed
- `tools`：开发期一键启动脚本

## 3. 系统组件关系

1. 管理员通过前端登录获取 JWT。
2. 前端通过 REST 调用 API 进行库存查询、调整、扣减、触发 AI 建议。
3. 前端通过 WebSocket 建立实时连接接收库存变更事件。
4. API 在事务中操作 PostgreSQL，写入库存快照与变更日志。
5. 库存变更后，API 向在线客户端广播 `inventory.changed` 事件。
6. AI 任务读取近 7 天日志聚合，调用 Provider 生成建议并落库。

## 4. 核心数据模型

### 4.1 主要表

- `admins`：管理员账号与角色
- `products`：商品主数据（含安全库存阈值）
- `inventories`：商品当前库存快照（`available_qty` + `version`）
- `inventory_logs`：库存变动流水（操作类型、delta、前后值、order_id）
- `restock_suggestions`：补货建议记录

### 4.2 关键约束

- `products.sku` 唯一。
- `inventories.available_qty >= 0`。
- `inventory_logs(order_id, product_id, op_type)` 唯一（仅 `order_id` 非空时），用于幂等。
- 变更流水按 `product_id + created_at` 建索引，加速近 7 天分析。

## 5. 防超卖与并发策略

并发扣减使用数据库事务 + 行锁：

1. 进入事务。
2. 按 `product_id` 对库存行 `SELECT ... FOR UPDATE`。
3. 校验库存是否充足。
4. 扣减库存并递增 `version`。
5. 写入 `inventory_logs`。
6. 提交事务后广播事件。

幂等策略：使用业务键 `order_id + product_id + op_type` 避免重复扣减。

## 6. 实时同步设计

### 6.1 连接与鉴权

- WebSocket 连接地址：`/ws?token=<jwt>`。
- 服务端在握手阶段校验 JWT，有效后加入连接池。

### 6.2 事件格式

事件类型：`inventory.changed`

字段：

- `eventId`：事件唯一 ID
- `ts`：事件时间
- `version`：库存版本号
- `payload`：`productId`、`sku`、`availableQty`、`safetyStock`、`delta`、`reason`

前端按 `productId` 定位行并更新库存与版本。

## 7. AI 补货建议流程

1. 读取每个商品近 7 天净变化与出库量。
2. 构造统一输入数据发送至 AI Provider。
3. Provider 返回建议：`productId`、`suggestedQty`、`reason`。
4. API 将建议写入 `restock_suggestions` 并返回前端。

默认回退策略（无外部 Key）：使用规则计算给出建议，保证功能可演示。

## 8. 安全与权限

- 管理员登录后发放 JWT。
- 库存、订单、AI 路由需鉴权。
- 库存变更写审计日志（`inventory_logs`）。

## 9. 可扩展性方向

- 多实例部署时将 WS 广播升级为 Redis Pub/Sub。
- 引入租户维度时在核心表加 `tenant_id` 并加入复合索引。
- 引入消息队列分离“在线事务”和“异步分析任务”。

## 10. 当前已知限制

- 目前单租户、单仓模型。
- 集成测试尚未落地（已登记在改进清单）。
- 生产级安全策略（限流、强密码策略、密钥管理）仍需完善。
