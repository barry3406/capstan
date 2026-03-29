[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文**

<div align="center">

<h1>
⚓ Capstan
</h1>

**AI Agent 原生全端框架**

一次 `defineAPI()` 呼叫，四種協定介面。同時服務人類與 AI Agent。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-177%20passing-brightgreen?logo=bun&logoColor=white)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.3-orange)](https://github.com/barry3406/capstan)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

[快速開始](#-快速開始) · [為什麼選擇 Capstan？](#-為什麼選擇-capstan) · [架構](#-架構) · [參與貢獻](#-參與貢獻)

</div>

---

## Capstan 是什麼？

**Capstan** 是一個全端 TypeScript 框架。你撰寫的每個 API 都能同時被人類（透過 REST）和 AI Agent（透過 MCP、A2A 及 OpenAPI）存取——完全不需要額外的程式碼。它結合了檔案式路由、Zod 驗證端點、Drizzle ORM 模型，以及內建的驗證系統，讓 AI 編碼 Agent 能以自我修正的 TDD 迴圈運作。

你可以把它想成：**如果 Next.js 從第一天就為一半消費者是 LLM 的世界而設計，它會是什麼樣子。**

## 運作原理

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
                瀏覽器      Claude     Agent        Swagger     Agent
                與應用程式  Desktop    網路          與 SDK     探索發現
```

**寫一次，到處服務。** 你的 `defineAPI()` 呼叫會同時成為 HTTP 端點、Claude Desktop 的 MCP 工具、Google Agent 間通訊（A2A）協定的技能，以及 OpenAPI 規格——全部自動產生。

---

## 🤔 為什麼選擇 Capstan？

| | **Next.js / Remix** | **FastAPI** | **Capstan** |
|---|---|---|---|
| **主要受眾** | 人類 | 人類 | 人類 + AI Agent |
| **API 定義** | 路由處理器 | 裝飾器 | 使用 Zod schema 的 `defineAPI()` |
| **Agent 協定** | 手動整合 | 手動整合 | 自動產生 MCP、A2A、OpenAPI |
| **Agent 探索** | 無 | 無 | `/.well-known/capstan.json` 清單 |
| **策略執行** | 自行撰寫中介層 | 依賴中介層 | `definePolicy()` 支援 allow / deny / redact |
| **人機協作審核** | 自行建置 | 自行建置 | 內建 Agent 寫入操作的核准工作流程 |
| **AI TDD 迴圈** | 無 | 無 | `capstan verify --json` 含修復清單 |
| **自動 CRUD** | 無 | 無 | `defineModel()` 產生型別化路由檔案 |
| **全端支援** | React SSR + API | 僅 API | React SSR + API + Agent 協定 |
| **安全性** | 自行處理 | 自行處理 | CSRF 防護、請求主體限制、核准端點驗證、可設定 CORS |

**核心理念：** 你建構的每個 API 本身就是一個 AI 工具。不需要包裝器、不需要轉接器、不需要第二套程式碼。

---

## 🚀 快速開始

```bash
# 1. 建立新專案
npx create-capstan-app my-app
cd my-app

# 2. 啟動開發伺服器
npx capstan dev

# 3. 你的應用程式已上線，所有協定介面皆可用：
#    http://localhost:3000              — 網頁應用程式
#    http://localhost:3000/openapi.json — OpenAPI 規格
#    http://localhost:3000/.well-known/capstan.json — Agent 清單
#    http://localhost:3000/.well-known/agent.json   — A2A Agent 名片

# 4. 驗證所有配置是否正確連接
npx capstan verify --json
```

### 快速建立功能鷹架

```bash
npx capstan add model ticket       # → app/models/ticket.model.ts
npx capstan add api tickets        # → app/routes/tickets/index.api.ts (GET + POST)
npx capstan add page tickets       # → app/routes/tickets/index.page.tsx
npx capstan add policy requireAuth # → app/policies/index.ts
```

### 正式部署

```bash
npx capstan build    # 建置正式版本
npx capstan start    # 啟動正式伺服器
```

---

## 📖 程式碼範例

### `defineAPI` — 型別安全的多協定端點

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
  policy: "requireAuth",  // ← 人類與 Agent 皆會執行此策略
  async handler({ input, ctx, params }) {
    return { id: crypto.randomUUID(), title: input.title };
  },
});
```

僅需這一個檔案，你就能獲得**以下所有功能**——不需要額外程式碼：

| 協定 | 端點 |
|------|------|
| REST API | `GET /tickets` · `POST /tickets` |
| MCP 工具 | `get_tickets` · `post_tickets`（具有真實的型別參數） |
| A2A 技能 | `get_tickets` · `post_tickets`（支援串流傳輸） |
| OpenAPI | 記錄於 `/openapi.json` |

### `defineModel` — 宣告式資料模型搭配自動 CRUD

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

執行 `capstan add api tickets`，Capstan 就會產生完整型別化的 CRUD 路由檔案，包含 Zod 驗證、策略執行與 Agent 中繼資料——可直接自訂使用。

### `definePolicy` — 具備 Agent 感知能力的權限策略

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

策略效果：**`allow`**（允許）| **`deny`**（拒絕）| **`approve`**（人機協作審核）| **`redact`**（過濾敏感欄位）

當策略回傳 `approve` 時，請求會進入**核准工作流程**——Agent 會收到 `202` 回應與 `pollUrl`，人類則在 `/capstan/approvals` 進行審核。

---

## 🔄 AI TDD 自我修正迴圈

Capstan 內建為 AI 編碼 Agent 設計的**驗證器**。當 Claude Code、Cursor 或任何 AI 助理在你的專案中工作時，它會在每次變更後執行 `capstan verify --json`，並利用結構化輸出自動修正問題。

```
   ┌───────────┐      ┌────────────┐      ┌─────────────────┐
   │  AI Agent  │─────▶│  編輯程式碼 │─────▶│ capstan verify   │
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
              讀取修復清單，            │     "autoFixable",   │
              套用修正                  │     "hint": "..."    │
                                        │   }]                 │
                                        │  }                   │
                                        └─────────────────────┘
```

### 七步驟驗證瀑布流程

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

**步驟逐層遞進**：structure → config → routes → models → typecheck → contracts → manifest。前期步驟失敗時，相依步驟會被略過以減少雜訊。

**修復分類**：`type_error` · `schema_mismatch` · `missing_file` · `policy_violation` · `contract_drift` · `missing_export`

---

## 🌐 多協定端點

執行 `capstan dev` 時，以下端點會自動產生：

| 端點 | 協定 | 用途 |
|------|------|------|
| `GET /.well-known/capstan.json` | Capstan | 包含所有能力的 Agent 清單 |
| `GET /.well-known/agent.json` | A2A | Google Agent 間通訊的 Agent 名片 |
| `POST /.well-known/a2a` | A2A | Agent 任務的 JSON-RPC 處理器（支援串流傳輸） |
| `GET /openapi.json` | OpenAPI 3.1 | 完整 API 規格文件 |
| `GET /capstan/approvals` | Capstan | 人機協作核准佇列 |
| `npx capstan mcp` | MCP (stdio) | 供 Claude Desktop / Cursor 使用（具有真實的型別參數） |

### 連接至 Claude Desktop

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

每個 `defineAPI()` 路由都會成為一個 MCP 工具。Claude 可以直接與你的應用程式互動。

---

## 🏗 架構

```
capstan.config.ts           ← 應用程式設定（資料庫、驗證、Agent 設定）
app/
  routes/
    index.page.tsx          ← React 頁面（搭配 loader 的 SSR）
    index.api.ts            ← API 處理器（匯出 GET、POST、PUT、DELETE）
    tickets/
      index.api.ts          ← 檔案式路由：/tickets
      [id].api.ts           ← 動態路段：/tickets/:id
    _layout.tsx             ← 版面配置
    _middleware.ts          ← 中介層
  models/
    ticket.model.ts         ← Drizzle ORM + defineModel()
  policies/
    index.ts                ← definePolicy() 權限規則
```

**技術堆疊：** [Hono](https://hono.dev)（HTTP）· [Drizzle](https://orm.drizzle.team)（ORM——SQLite、PostgreSQL、MySQL）· [React](https://react.dev)（SSR）· [Zod](https://zod.dev)（驗證）· [Bun](https://bun.sh)（測試）

**開發特性：** 即時重新載入（SSE）、從 `app/public/` 提供靜態資源、結構化日誌

**正式部署：** `capstan build` + `capstan start`

**安全性：** CSRF 防護、請求主體限制、核准端點驗證、可設定 CORS

---

## 📦 套件

### 執行時期套件（9 個）

| 套件 | 說明 |
|------|------|
| `@zauso-ai/capstan-core` | Hono 伺服器、`defineAPI`、`defineMiddleware`、`definePolicy`、核准工作流程、驗證器 |
| `@zauso-ai/capstan-router` | 檔案式路由（`.page.tsx`、`.api.ts`、`_layout.tsx`、`_middleware.ts`） |
| `@zauso-ai/capstan-db` | Drizzle ORM、`defineModel`、欄位/關聯輔助函式、遷移、自動 CRUD（SQLite + PostgreSQL + MySQL） |
| `@zauso-ai/capstan-auth` | JWT 工作階段、Agent 用 API 金鑰驗證、權限檢查 |
| `@zauso-ai/capstan-agent` | `CapabilityRegistry`、MCP 伺服器、A2A 轉接器、OpenAPI 產生器 |
| `@zauso-ai/capstan-react` | 搭配 loader 的 SSR、版面配置、`Outlet`、hydration |
| `@zauso-ai/capstan-dev` | 開發伺服器，含檔案監看、即時重新載入、MCP/A2A 端點 |
| `@zauso-ai/capstan-cli` | CLI：`dev`、`build`、`start`、`verify`、`add`、`mcp`、`db:*` |
| `create-capstan-app` | 專案鷹架工具（空白與 tickets 範本） |

### 編譯器系統（舊版——已分離）

| 套件 | 說明 |
|------|------|
| `@zauso-ai/capstan-app-graph` | 應用程式圖結構描述、驗證、差異比對 |
| `@zauso-ai/capstan-brief` | Brief 至圖結構編譯 |
| `@zauso-ai/capstan-compiler` | 圖結構至應用程式碼產生 |
| `@zauso-ai/capstan-packs-core` | 可組合套件（驗證、多租戶、工作流程、帳務、商務） |
| `@zauso-ai/capstan-surface-web` | 網頁介面投射 |
| `@zauso-ai/capstan-surface-agent` | Agent 介面投射 |
| `@zauso-ai/capstan-feedback` | 驗證與診斷 |
| `@zauso-ai/capstan-release` | 發佈規劃與回滾 |
| `@zauso-ai/capstan-harness` | 持久化任務執行環境 |

---

## 🧑‍💻 參與貢獻

Capstan 目前為 `v1.0.0-beta.3`。歡迎參與貢獻！

```bash
git clone https://github.com/barry3406/capstan.git
cd capstan
npm install
npm run build        # 建置所有套件
npm run test:new     # Bun 測試（177 項測試通過）
```

### 開發慣例

- 僅使用 ESM，匯入路徑須加上 `.js` 副檔名
- 嚴格 TypeScript（`exactOptionalPropertyTypes`、`verbatimModuleSyntax`）
- 所有 API 處理器皆使用 `defineAPI()` 搭配 Zod schema
- 寫入端點必須引用 `policy`
- Handler 接收 `{ input, ctx, params }`

### 歡迎協助

- 更多鷹架範本
- 文件網站
- 更多整合測試

---

## 📝 授權條款

[MIT](LICENSE)

---

<div align="center">

**⚓ Capstan** — 同時說人話與機器語言的 API。

[立即開始](#-快速開始) · [GitHub](https://github.com/barry3406/capstan) · [回報問題](https://github.com/barry3406/capstan/issues)

</div>
