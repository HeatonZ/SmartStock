# 智能仓储协同系统（Deno + Vue3）

## 项目目标

为跨境电商仓储场景提供一个可运行的原型，覆盖：

- 实时库存看板（WebSocket 无刷新同步）
- 并发扣减库存（防超卖）
- AI 补货建议（基于近 7 天库存日志）
- PostgreSQL 持久化

## 目录结构

- `apps/api`：Deno + Hono 后端 API 与 WebSocket
- `apps/web`：Vue3 前端管理看板
- `packages/shared-types`：共享类型定义
- `packages/ai-provider`：AI Provider 抽象与适配
- `infra/db`：数据库 DDL 与 seed
- `tools`：开发期一键启动脚本

## 启动步骤

1. 复制环境变量

   ```bash
   cp .env.example .env
   ```

2. 启动 PostgreSQL（本地确保库存在）

   - 默认连接：`postgres://postgres:123456@localhost:5432/smartstock`
   - 可选 Docker 启动：

   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d
   ```

3. 初始化数据库

   ```bash
   deno task db:init
   deno task db:seed
   ```

4. 一键启动前后端

   ```bash
   deno task dev
   ```

   - 启动时会自动执行后端连通性预检（环境变量格式 + PostgreSQL 可达性）。
   - 预检失败时后端不会启动，并输出明确错误原因。

   - 后端：`http://localhost:8000`
   - 前端：`http://localhost:5173`

> 仅启动前端（`deno task web:dev`）时，页面会进入“离线演示模式”，可直接看到示例库存与补货建议，不会白屏。

5. 运行单元测试

   ```bash
   deno task test
   ```

## AI Provider 配置（含 Kimi）

- 使用 Kimi 时请设置：

   ```dotenv
   AI_PROVIDER=kimi
   KIMI_API_KEY=<你的 Moonshot API Key>
   KIMI_MODEL=moonshot-v1-8k
   ```

- Kimi 接入方式为 Moonshot OpenAI 兼容接口（`https://api.moonshot.cn/v1`）。
- `KIMI_MODEL` 可按需替换为你在 Moonshot 平台可用的模型。

## 默认演示账号

- `admin@smartstock.local` / `admin123456`
- `ops1@smartstock.local` / `ops123456`
- `ops2@smartstock.local` / `ops123456`

## 文档索引

- 系统架构文档：`docs/architecture.md`
- 待改进清单：`docs/improvements.md`

## 核心接口

- `POST /api/auth/login`
- `GET /api/inventory/dashboard`
- `GET /api/inventory/logs?page=1&pageSize=10`
- `POST /api/inventory/adjust`
- `POST /api/orders/deduct`
- `POST /api/orders/simulate`
- `POST /api/ai/restock-suggestions/generate`
- `GET /api/admins`
- `GET /ws?token=<jwt>`
