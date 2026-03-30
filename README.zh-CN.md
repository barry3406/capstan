[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md)

<div align="center">

<h1>
⚓ Capstan
</h1>

**AI Agent 原生全栈框架**

一次 `defineAPI()` 调用，四种协议接口。同时服务人类用户与 AI Agent。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-177%20passing-brightgreen?logo=bun&logoColor=white)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.5-orange)](https://github.com/barry3406/capstan)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

[快速上手](#-快速上手) · [为什么选择 Capstan？](#-为什么选择-capstan) · [架构](#-架构) · [参与贡献](#-参与贡献)

</div>

---

## Capstan 是什么？

**Capstan** 是一个全栈 TypeScript 框架。你编写的每一个 API，都能同时被人类（通过 REST）和 AI Agent（通过 MCP、A2A、OpenAPI）直接访问——无需任何额外代码。框架集成了基于文件的路由、Zod 数据校验、Drizzle ORM 模型定义，以及内置的验证系统——AI 编程助手可以将其作为自纠错的 TDD 循环使用。

可以这样理解：**如果 Next.js 从第一天就为「一半用户是大语言模型」的世界而设计，它就会是 Capstan 的样子**。

## 工作原理

```
                        ┌──────────────────────────────────────────────┐
                        │              defineAPI({ ... })               │
                        │   input: z.object   output: z.object         │
                        │   capability  ·  policy  ·  handler          │
                        └──────────────────┬───────────────────────────┘
                                           │
                                  CapabilityRegistry
                                           │
                    ┌──────────┬───────────┼───────────┬──────────┐
                    ▼          ▼           ▼           ▼          ▼
              ┌──────────┐┌────────┐┌───────────┐┌─────────┐┌────────────┐
              │ HTTP/JSON ││  MCP   ││    A2A    ││ OpenAPI ││  Capstan   │
              │   API     ││ Tools  ││  Skills   ││  3.1    ││  Manifest  │
              │  (Hono)   ││ (stdio)││ (Google)  ││  Spec   ││   .json    │
              └──────────┘└────────┘└───────────┘└─────────┘└────────────┘
                   │           │          │            │           │
                浏览器      Claude     Agent         Swagger    Agent
                和应用     Desktop     网络          及 SDK     发现
```

**一次编写，处处可用。** 你的 `defineAPI()` 会自动生成 HTTP 端点、Claude Desktop 可用的 MCP 工具、Google Agent-to-Agent 协议的 A2A 技能，以及 OpenAPI 规范——全部自动完成。

---

## 🤔 为什么选择 Capstan？

| | **Next.js / Remix** | **FastAPI** | **Capstan** |
|---|---|---|---|
| **目标用户** | 人类 | 人类 | 人类 + AI Agent |
| **API 定义方式** | 路由处理函数 | 装饰器 | `defineAPI()` + Zod Schema |
| **Agent 协议** | 需手动集成 | 需手动集成 | 自动生成 MCP、A2A、OpenAPI |
| **Agent 发现** | 无 | 无 | `/.well-known/capstan.json` 清单 |
| **权限策略** | 自行实现中间件 | 取决于中间件 | `definePolicy()` 支持 allow / deny / redact |
| **人机协同审批** | 自行搭建 | 自行搭建 | 内置审批工作流，用于 Agent 写操作 |
| **AI TDD 循环** | 无 | 无 | `capstan verify --json` 附修复清单 |
| **自动 CRUD** | 无 | 无 | `defineModel()` 自动生成带类型的路由文件 |
| **全栈能力** | React SSR + API | 仅 API | React SSR + API + Agent 协议 |

**核心洞察：** 你构建的每一个 API，天然就是一个 AI 工具。无需包装器，无需适配器，无需维护第二套代码。

---

## 🚀 快速上手

```bash
# 1. 创建新项目（支持模板选择）
npx create-capstan-app my-app --template tickets
cd my-app

# 2. 启动开发服务器
npx capstan dev

# 3. 你的应用已在所有协议上运行：
#    http://localhost:3000              — Web 应用
#    http://localhost:3000/openapi.json — OpenAPI 规范
#    http://localhost:3000/.well-known/capstan.json — Agent 清单
#    http://localhost:3000/.well-known/agent.json   — A2A Agent 名片

# 4. 验证一切是否正确连接
npx capstan verify --json
```

### 快速生成功能模块

```bash
npx capstan add model ticket       # → app/models/ticket.model.ts
npx capstan add api tickets        # → app/routes/tickets/index.api.ts (GET + POST)
npx capstan add page tickets       # → app/routes/tickets/index.page.tsx
npx capstan add policy requireAuth # → app/policies/index.ts
```

### 生产部署

```bash
npx capstan build    # 编译并优化应用
npx capstan start    # 以生产模式启动
```

---

## 📖 代码示例

### `defineAPI` — 类型安全的多协议端点

```typescript
// app/routes/tickets/index.api.ts
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({
    status: z.enum(["open", "in_progress", "closed", "all"]).optional(),
  }),
  output: z.object({
    tickets: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      priority: z.string(),
    })),
  }),
  description: "List all tickets",
  capability: "read",
  resource: "ticket",
  async handler({ input, ctx, params }) {
    const tickets = await db.query.tickets.findMany();
    return { tickets };
  },
});

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1).max(200),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  output: z.object({ id: z.string(), title: z.string() }),
  description: "Create a new ticket",
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",  // ← 对人类和 Agent 统一执行策略
  async handler({ input, ctx, params }) {
    return { id: crypto.randomUUID(), title: input.title };
  },
});
```

仅凭这一个文件，你就获得了以下**全部能力**——无需额外代码：

| 协议 | 端点 |
|------|------|
| REST API | `GET /tickets` · `POST /tickets` |
| MCP Tool | `get_tickets` · `post_tickets`（带完整类型参数） |
| A2A Skill | `get_tickets` · `post_tickets`（支持流式传输） |
| OpenAPI | 自动收录至 `/openapi.json` |

### `defineModel` — 声明式数据模型，自动生成 CRUD

```typescript
// app/models/ticket.model.ts
import { defineModel, field } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id:          field.id(),
    title:       field.string({ required: true, min: 1, max: 200 }),
    description: field.text(),
    status:      field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority:    field.enum(["low", "medium", "high"], { default: "medium" }),
    createdAt:   field.datetime({ default: "now" }),
    updatedAt:   field.datetime({ updatedAt: true }),
  },
});
```

运行 `capstan add api tickets`，Capstan 会自动生成包含 Zod 校验、权限策略和 Agent 元数据的完整类型化 CRUD 路由文件——随时可以按需定制。

### `definePolicy` — 感知 Agent 身份的权限策略

```typescript
// app/policies/index.ts
import { definePolicy } from "@zauso-ai/capstan-core";

export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Authentication required" };
    }
    return { effect: "allow" };
  },
});

export const agentApproval = definePolicy({
  key: "agentApproval",
  title: "Agent Actions Require Approval",
  effect: "approve",
  async check({ ctx }) {
    if (ctx.auth.type === "agent") {
      return { effect: "approve", reason: "Agent write ops need human review" };
    }
    return { effect: "allow" };
  },
});
```

策略效果：**`allow`**（放行）| **`deny`**（拒绝）| **`approve`**（需人工审批）| **`redact`**（脱敏过滤）

当策略返回 `approve` 时，请求将进入**审批工作流**——Agent 会收到 `202` 响应和一个 `pollUrl`，人类审批者可在 `/capstan/approvals` 页面进行审核。

---

## 🔄 AI TDD 自纠错循环

Capstan 内置的**验证器**专为 AI 编程助手设计。当 Claude Code、Cursor 或其他 AI 助手在你的项目中工作时，它们会在每次修改后运行 `capstan verify --json`，并根据结构化输出自动修正错误。

```
   ┌───────────┐      ┌────────────┐      ┌─────────────────┐
   │  AI Agent  │─────▶│  编辑代码  │─────▶│ capstan verify   │
   │  (Claude,  │      │            │      │   --json         │
   │   Cursor)  │      └────────────┘      └───────┬─────────┘
   └─────▲──────┘                                  │
         │                                         ▼
         │                              ┌─────────────────────┐
         │                              │  {                   │
         │                              │   "status": "failed",│
         │                              │   "repairChecklist": │
         │                              │   [{                 │
         └──────────────────────────────│     "fixCategory",   │
              读取清单，                │     "autoFixable",   │
              应用修复                  │     "hint": "..."    │
                                        │   }]                 │
                                        │  }                   │
                                        └─────────────────────┘
```

### 七步级联验证

```bash
$ npx capstan verify --json
```

```json
{
  "status": "failed",
  "steps": [
    { "name": "structure",  "status": "passed", "durationMs": 2 },
    { "name": "config",     "status": "passed", "durationMs": 15 },
    { "name": "routes",     "status": "failed", "durationMs": 8,
      "diagnostics": [{
        "code": "MISSING_POLICY",
        "severity": "warning",
        "message": "POST /tickets has capability 'write' but no policy",
        "hint": "Add policy: \"requireAuth\" to protect write endpoints",
        "file": "app/routes/tickets/index.api.ts",
        "fixCategory": "policy_violation",
        "autoFixable": true
      }]
    },
    { "name": "models",     "status": "passed", "durationMs": 3 },
    { "name": "typecheck",  "status": "failed", "durationMs": 1200 },
    { "name": "contracts",  "status": "skipped" },
    { "name": "manifest",   "status": "skipped" }
  ],
  "repairChecklist": [
    {
      "index": 1,
      "step": "routes",
      "message": "POST /tickets missing policy",
      "hint": "Add policy: \"requireAuth\"",
      "fixCategory": "policy_violation",
      "autoFixable": true
    }
  ]
}
```

**级联执行：** structure → config → routes → models → typecheck → contracts → manifest。前序步骤失败时，依赖它的后续步骤会自动跳过，减少干扰信息。

**修复类别：** `type_error` · `schema_mismatch` · `missing_file` · `policy_violation` · `contract_drift` · `missing_export`

---

## 🌐 多协议端点

运行 `capstan dev` 后，以下端点自动生成：

| 端点 | 协议 | 用途 |
|------|------|------|
| `GET /.well-known/capstan.json` | Capstan | Agent 能力清单 |
| `GET /.well-known/agent.json` | A2A | Google Agent-to-Agent 名片 |
| `POST /.well-known/a2a` | A2A | JSON-RPC 处理程序，支持流式传输 |
| `GET /openapi.json` | OpenAPI 3.1 | 完整的 API 规范 |
| `GET /capstan/approvals` | Capstan | 人机协同审批队列（需鉴权） |
| `npx capstan mcp` | MCP (stdio) | 接入 Claude Desktop / Cursor |

### 接入 Claude Desktop

```json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["capstan", "mcp"],
      "cwd": "/path/to/my-app"
    }
  }
}
```

每个 `defineAPI()` 路由都会成为一个带完整类型参数的 MCP 工具。Claude 可以原生地与你的应用交互。

---

## 🔒 安全

Capstan 内置多层安全防护：

- **CSRF 保护** — 自动防御跨站请求伪造攻击
- **请求体大小限制** — 可配置的请求体上限，防止过大载荷
- **审批端点鉴权** — `/capstan/approvals` 端点要求身份认证
- **可配置 CORS** — 灵活的跨域资源共享策略
- **Agent API Key 认证** — Agent 请求通过 API Key 鉴权
- **权限策略系统** — `definePolicy()` 对人类和 Agent 统一执行访问控制

---

## 🏗 架构

```
capstan.config.ts           ← 应用配置（数据库、认证、Agent 设置）
app/
  routes/
    index.page.tsx          ← React 页面（SSR + loader）
    index.api.ts            ← API 处理函数（导出 GET、POST、PUT、DELETE）
    tickets/
      index.api.ts          ← 文件路由：/tickets
      [id].api.ts           ← 动态路由段：/tickets/:id
    _layout.tsx             ← 布局组件
    _middleware.ts          ← 中间件
  models/
    ticket.model.ts         ← Drizzle ORM + defineModel()
  policies/
    index.ts                ← definePolicy() 权限规则
  public/                   ← 静态资源目录
```

**技术栈：** [Hono](https://hono.dev)（HTTP）· [Drizzle](https://orm.drizzle.team)（ORM — 支持 SQLite、PostgreSQL、MySQL）· [React](https://react.dev)（SSR）· [Zod](https://zod.dev)（校验）· [Bun](https://bun.sh)（测试）

**开发特性：** 实时刷新（SSE）、`app/public/` 静态资源托管、结构化日志、`capstan build` + `capstan start` 生产部署

---

## 📦 包一览

### 运行时框架（9 个包）

| 包名 | 说明 |
|------|------|
| `@zauso-ai/capstan-core` | Hono 服务器、`defineAPI`、`defineMiddleware`、`definePolicy`、审批工作流、验证器 |
| `@zauso-ai/capstan-router` | 文件路由（`.page.tsx`、`.api.ts`、`_layout.tsx`、`_middleware.ts`） |
| `@zauso-ai/capstan-db` | Drizzle ORM、`defineModel`、字段/关联辅助函数、数据迁移、自动 CRUD |
| `@zauso-ai/capstan-auth` | JWT 会话、Agent API Key 认证、权限检查 |
| `@zauso-ai/capstan-agent` | `CapabilityRegistry`、MCP 服务器、A2A 适配器、OpenAPI 生成器 |
| `@zauso-ai/capstan-react` | SSR + loader、布局组件、`Outlet`、客户端水合 |
| `@zauso-ai/capstan-dev` | 开发服务器，支持文件监听、路由热重载、MCP/A2A 端点 |
| `@zauso-ai/capstan-cli` | CLI 命令：`dev`、`build`、`start`、`verify`、`add`、`mcp`、`db:*` |
| `create-capstan-app` | 项目脚手架（空白模板和 tickets 模板，支持 `--template` 参数） |

> 遗留编译系统包已分离至独立仓库，不再包含在运行时发行版中。

---

## 🧑‍💻 参与贡献

Capstan 目前处于 Beta 阶段（`v1.0.0-beta.5`），欢迎贡献！

```bash
git clone https://github.com/barry3406/capstan.git
cd capstan
npm install
npm run build        # 构建所有包
npm run test:new     # Bun 测试（177 项测试，全部通过）
```

### 开发规范

- 仅使用 ESM，import 路径需带 `.js` 扩展名
- 严格模式 TypeScript（`exactOptionalPropertyTypes`、`verbatimModuleSyntax`）
- 所有 API 处理函数使用 `defineAPI()` + Zod Schema
- 写操作端点必须关联 `policy`
- Handler 签名：`handler({ input, ctx, params })`

### 期待你的参与

- 文档站点建设
- 更多脚手架模板
- 更多集成测试

---

## 📝 许可证

[MIT](LICENSE)

---

<div align="center">

**⚓ Capstan** — 人机共通的 API。

[快速上手](#-快速上手) · [GitHub](https://github.com/barry3406/capstan) · [报告问题](https://github.com/barry3406/capstan/issues)

</div>
