[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文**

<div align="center">

<h1>
⚓ Capstan
</h1>

**Bun 原生 AI Agent 全端框架**

一次 `defineAPI()` 呼叫，四種協定介面。同時服務人類與 AI Agent。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-full%20suite%20passing-brightgreen?logo=bun&logoColor=white)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.7-orange)](https://github.com/barry3406/capstan)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

[快速開始](#-快速開始) · [為什麼選擇 Capstan？](#-為什麼選擇-capstan) · [架構](#-架構) · [文件](#-文件) · [參與貢獻](#-參與貢獻)

</div>

---

## Capstan 是什麼？

**Capstan** 是一個 Bun 原生的全端 TypeScript 框架，目標是讓應用程式預設就對 Agent 可操作。同一份 `defineAPI()` 契約，可以同時驅動面向人的 HTTP 介面、面向 AI 的 MCP/A2A/OpenAPI 介面、面向操作員的工作流介面，以及面向編碼 Agent 的結構化驗證，而不需要再補一層轉接膠水。它結合了檔案式路由、Zod 驗證端點、Drizzle ORM 模型、內建策略與核准原語，以及可讓編碼 Agent 收斂修復的驗證閉環。

在正式環境裡，`capstan build` 會產生可部署產物，`capstan start` 會啟動執行時；框架也預設提供 CSRF 防護、可設定 CORS、請求主體限制、結構化日誌與明確的建置清單。Bun 是首選執行環境，同時也完整支援 Node.js。

你可以把它理解成：一個為「人類、編碼 Agent 與營運/監督工具要共享同一份應用契約」而設計的全端框架。

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
| **驗證模型** | 自行處理 | 自行處理 | 內建 `"human"` / `"agent"` / `"anonymous"` |
| **策略執行** | 自行撰寫中介層 | 依賴中介層 | `definePolicy()` 支援 approve / deny / redact |
| **人機協作審核** | 自行建置 | 自行建置 | 內建 Agent 寫入操作的核准工作流程 |
| **AI TDD 迴圈** | 無 | 無 | `capstan verify --json` 含修復清單 |
| **自動 CRUD** | 無 | 無 | `defineModel()` 產生型別化路由檔案 |
| **資料庫** | 自行整合 | SQLAlchemy | Drizzle ORM（SQLite、PostgreSQL、MySQL） |
| **正式部署** | `next build` / `next start` | Uvicorn | `capstan build` / `capstan start` |
| **全端支援** | React SSR + API | 僅 API | React SSR + API + Agent 協定 |
| **安全性** | 自行處理 | 自行處理 | DPoP (RFC 9449)、SPIFFE/mTLS、CSRF 防護、可設定 CORS |

**核心理念：** 應用契約應該是共享的。同一份 capability 定義，應同時驅動 API、Agent 協定、監督流程、驗證與發布。

---

## ✨ 功能列表

### 核心框架
- **`defineAPI()` 多協定端點** — 一次定義，自動產生 HTTP、MCP、A2A、OpenAPI 四種介面
- **檔案式路由** — `.page.tsx`、`.api.ts`、`_layout.tsx`、`_middleware.ts`
- **`defineModel()` 自動 CRUD** — Drizzle ORM 搭配 SQLite、PostgreSQL、MySQL
- **`definePolicy()` 權限策略** — allow / deny / approve / redact 四種效果
- **核准工作流程** — Agent 寫入操作的人機協作審核
- **AI TDD 自我修正迴圈** — `capstan verify --json` 含結構化修復清單

### 資料與 AI
- **向量欄位 & RAG 原語** — `defineEmbedding` 搭配混合搜尋（語意 + 關鍵字）
- **LangChain 整合** — 原生整合 LangChain 生態系
- **AI 工具包（`@zauso-ai/capstan-ai`）** — 獨立 AI 工具包：`createAI()` 工廠函式（無需 Capstan 框架即可使用）、`think<T>(prompt, { schema })` 結構化推理、`generate(prompt)` 文字生成、串流變體、依 scope 隔離的 `remember()`/`recall()` / `assembleContext()` 記憶原語、`memory.about(type, id)` 實體級記憶、帶一等 task 執行的宿主驅動 `agent.run()`
- **Agent Harness 模式** — `createHarness()` 組合瀏覽器沙箱（Playwright 或 Camoufox kernel）、檔案系統沙箱、LLM 自我驗證與可觀測性，適合長時間運行 Agent
- **定時 Agent 排程（`@zauso-ai/capstan-cron`）** — 作為 cron 觸發層，把定時任務提交進 harness/runtime，而不是把排程與執行揉在一起

### 前端
- **React SSR** — 搭配 loader 的伺服器端渲染、版面配置、`Outlet`、hydration
- **選擇性 hydration** — `full` / `visible` / `none` 三種 hydration 模式
- **React Server Components 基礎** — RSC 基礎架構支援，`ClientOnly`、`serverOnly()` 守衛
- **Image & Font 最佳化** — 響應式 srcset、預載入、延遲載入、模糊佔位符、`defineFont()` 支援 CSS 變數
- **Metadata API** — `defineMetadata()` 用於 SEO、OpenGraph、Twitter Cards，支援標題範本和 `mergeMetadata()`
- **錯誤邊界與重設** — `<ErrorBoundary fallback={...}>` 支援重試，`<NotFound>` 404 元件；`_error.tsx` 檔案慣例實現目錄級錯誤邊界
- **載入 UI** — `_loading.tsx` 檔案慣例用於 Suspense 回退，按目錄作用域（同佈局）
- **快取層與 ISR** — `cacheSet`/`cacheGet` 支援 TTL + 標籤，`cached()` stale-while-revalidate 裝飾器，`cacheInvalidateTag()` 批次失效
- **回應快取與渲染策略** — 頁面級 `renderMode: "isr"` 搭配回應快取，背景重驗證，交叉失效
- **客戶端 SPA 路由** — `<Link>` 元件支援預取（`hover` / `viewport` / `none`），`useNavigate()`、`useRouterState()` Hook，基於 history 的捲動恢復，零設定 View Transitions
- **CSS 管線** — 內建 Lightning CSS 處理，Tailwind v4 自動偵測，零設定

### Agent 協定
- **MCP 伺服器** — stdio 傳輸，供 Claude Desktop / Cursor 使用
- **MCP Streamable HTTP 傳輸** — 基於 HTTP 的 MCP 串流傳輸
- **MCP 用戶端** — 消費外部 MCP 伺服器，連接第三方 Agent 工具
- **A2A 轉接器** — Google Agent 間通訊協定，支援 SSE 串流
- **OpenAPI 3.1 產生器** — 自動產生完整 API 規格文件
- **Capstan Agent 清單** — `/.well-known/capstan.json` 能力探索

### 安全性
- **OAuth 社交登入** — 內建 Google、GitHub 提供者，`createOAuthHandlers()` 自動完成授權流程與工作階段建立
- **DPoP (RFC 9449)** — 展示證明持有者（Demonstration of Proof-of-Possession）令牌綁定
- **SPIFFE/mTLS 工作負載身份** — 服務間安全通訊的工作負載身份驗證
- **Token 級別限流** — 區分人類與 Agent 的差異化限流策略
- **JWT 工作階段 & API 金鑰** — 人類與 Agent 的雙軌驗證機制
- **CSRF 防護** — 跨站請求偽造防護
- **可設定 CORS** — 彈性的跨來源資源共享設定

### 外掛與擴充
- **`definePlugin()` 外掛系統** — 透過 `addRoute`、`addPolicy`、`addMiddleware` 擴充應用；在 config 中以 `plugins: []` 載入
- **可插拔狀態存儲** — `KeyValueStore<T>` 介面，預設使用 `MemoryStore`；透過 `setApprovalStore()`、`setRateLimitStore()`、`setDpopReplayStore()`、`setAuditStore()` 切換至 Redis 或其他外部後端
- **Redis 狀態後端** — 內建 `RedisStore` 適配器，用於正式環境的持久化狀態儲存
- **OAuth 提供者** — 內建 `googleProvider()`、`githubProvider()` 與 `createOAuthHandlers()`，支援社交登入並自動建立工作階段
- **LLM 提供者** — 內建 `openaiProvider()` 與 `anthropicProvider()`，統一的聊天與串流介面
- **Vite 建置管線** — 可選的 Vite 整合，支援客戶端程式碼分割、HMR 與正式建置
- **部署適配器** — Cloudflare Workers（`createCloudflareHandler`）、Vercel（Edge + Node.js）、Fly.io（寫入重播）

### 合規
- **EU AI Act 合規原語** — `defineCompliance()` 設定風險等級、稽核日誌與透明度聲明；自動產生 `GET /capstan/audit` 端點

### 開發與建置
- **WebSocket 支援** — `defineWebSocket()` 即時端點，`WebSocketRoom` 發布/訂閱廣播
- **互動式 CLI** — 彩色輸出、分組說明、模糊比對、`@clack/prompts` 互動式鷹架及自動安裝
- **Bun 原生** — 首選執行環境為 Bun，使用 `Bun.serve()` 和 `Bun.spawn()`；同時完整支援 Node.js
- **Turborepo 並行建構** — 利用 Turborepo 實現多套件並行建置
- **OpenTelemetry 跨協議追蹤** — HTTP、MCP、A2A 跨協議的可觀測性追蹤
- **即時重新載入** — SSE 驅動的開發伺服器即時重新載入

### 測試
- **MCP 測試工具包** — 專為 MCP 工具互動設計的測試輔助工具
- **跨協議 contract 一致性測試** — 確保 HTTP、MCP、A2A、OpenAPI 四種協議的 contract 一致
- **AI TDD 驗證器** — 結構化 JSON 診斷輸出，含自動修復分類

---

## 🚀 快速開始

```bash
# 1. 建立新專案
bunx create-capstan-app my-app
cd my-app

# 或從範本開始
bunx create-capstan-app my-app --template tickets

# 2. 啟動開發伺服器（SSE 即時重新載入）
bun run dev

# 3. 你的應用程式已上線，所有協定介面皆可用：
#    http://localhost:3000              — 網頁應用程式
#    http://localhost:3000/openapi.json — OpenAPI 規格
#    http://localhost:3000/.well-known/capstan.json — Agent 清單
#    http://localhost:3000/.well-known/agent.json   — A2A Agent 名片

# 4. 驗證所有配置是否正確連接
bunx capstan verify --json
```

> **Node.js 同樣可用：** 將上面的 `bunx` 替換為 `npx`，`bun run` 替換為 `npx` 即可。

### 快速建立功能鷹架

```bash
bunx capstan add model ticket       # → app/models/ticket.model.ts
bunx capstan add api tickets        # → app/routes/tickets/index.api.ts (GET + POST)
bunx capstan add page tickets       # → app/routes/tickets/index.page.tsx
bunx capstan add policy requireAuth # → app/policies/index.ts
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

### 八步驟驗證瀑布流程

```bash
$ bunx capstan verify --json
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
| `bunx capstan mcp` | MCP (stdio) | 供 Claude Desktop / Cursor 使用（具有真實的型別參數） |

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
  public/
    favicon.ico             ← 靜態資源（自動提供服務）
    logo.svg
```

**技術堆疊：** [Hono](https://hono.dev)（HTTP）· [Drizzle](https://orm.drizzle.team)（ORM——SQLite、PostgreSQL、MySQL）· [React](https://react.dev)（SSR）· [Zod](https://zod.dev)（驗證）· [Bun](https://bun.sh)（測試）

**開發特性：** 即時重新載入（SSE）、從 `app/public/` 提供靜態資源、結構化 JSON 日誌

**安全性：** CSRF 防護、請求主體限制、可設定 CORS、核准端點驗證

---

## 🚢 正式部署

```bash
# 建置正式版本
bunx capstan build

# 建置 standalone 部署套件
bunx capstan build --target node-standalone

# 建置可直接 docker build 的部署套件
bunx capstan build --target docker

# 建置 Vercel / Cloudflare / Fly 目標
bunx capstan build --target vercel-node
bunx capstan build --target vercel-edge
bunx capstan build --target cloudflare
bunx capstan build --target fly

# 依目標在專案根目錄產生部署檔案
bunx capstan deploy:init --target vercel-edge

# 啟動正式伺服器
bunx capstan start

# 從 standalone 產物啟動
bunx capstan start --from dist/standalone

# 發布前驗證部署產物
bunx capstan verify --deployment --target vercel-edge
```

`capstan build` 會將你的路由、模型與設定編譯為最佳化的正式版本套件。`capstan start` 啟動伺服器時會預設開啟安全性設定——Bun 上使用 `Bun.serve()`，Node.js 上使用 `node:http`。可在 `capstan.config.ts` 中設定監聽連接埠、CORS 來源與資料庫提供者。

建置輸出現在是顯式且可機器讀取的：`dist/_capstan_server.js` 是正式入口，`dist/deploy-manifest.json` 描述部署契約，而從 `app/public/` 複製出的靜態資源在正式環境也和開發環境一樣直接掛載在根路徑。只要使用顯式部署目標，Capstan 都會產生 `dist/standalone/` 與其執行時期 `package.json`；接著再疊加平台檔案，例如 Vercel 的 `api/index.js` + `vercel.json`、Cloudflare 的 `worker.js` + `wrangler.toml`、Fly.io 的 `fly.toml` 與 Docker 資產。`capstan verify --deployment --target <target>` 會在發布前驗證這些部署契約。

語義化運維現在也是預設執行時閉環的一部分。開發環境與 portable runtime 建置會把結構化事件、事故與健康快照寫入專案根目錄下的 `.capstan/ops/ops.db`，而 CLI 可以直接透過 `capstan ops:events`、`capstan ops:incidents`、`capstan ops:health` 與 `capstan ops:tail` 檢查。

---

## 📚 文件

詳細指南位於 [`docs/`](docs/) 目錄：

- [快速入門](docs/getting-started.md) — 安裝、第一個專案、開發工作流程
- [核心概念](docs/core-concepts.md) — `defineAPI`、`defineModel`、`definePolicy`、能力
- [架構](docs/architecture/) — 系統設計、多協定 registry、路由掃描
- [驗證](docs/authentication.md) — JWT 工作階段、API 金鑰、驗證類型
- [資料庫](docs/database.md) — SQLite、PostgreSQL、MySQL 設定與遷移
- [部署](docs/deployment.md) — `capstan build`、平台 target、`deploy:init`、`verify --deployment`
- [測試策略](docs/testing-strategy.md) — 單元測試、整合測試、驗證器測試
- [API 參考](docs/api-reference.md) — 完整 API 介面文件
- [比較](docs/comparison.md) — Capstan 與 Next.js、FastAPI 及其他框架的比較
- [路線圖](docs/roadmap.md) — 未來規劃

---

## 📦 套件

Capstan 目前包含 12 個工作區套件：

| 套件 | 說明 |
|------|------|
| `@zauso-ai/capstan-core` | Hono 伺服器、`defineAPI`、`defineMiddleware`、`definePolicy`、核准工作流程、驗證器 |
| `@zauso-ai/capstan-router` | 檔案式路由（`.page.tsx`、`.api.ts`、`_layout.tsx`、`_middleware.ts`） |
| `@zauso-ai/capstan-db` | Drizzle ORM、`defineModel`、欄位/關聯輔助函式、遷移、自動 CRUD（SQLite、PostgreSQL、MySQL） |
| `@zauso-ai/capstan-auth` | JWT 工作階段、Agent 用 API 金鑰驗證、OAuth 提供者（Google、GitHub）、權限檢查（`"human"` / `"agent"` / `"anonymous"`） |
| `@zauso-ai/capstan-agent` | `CapabilityRegistry`、MCP 伺服器（型別化參數）、A2A 轉接器（SSE）、OpenAPI 產生器 |
| `@zauso-ai/capstan-ai` | 獨立 AI 工具包：`createAI`、`think`/`generate`（結構化 + 串流）、scope 化記憶原語、帶一等 task 執行的宿主驅動 `agent.run()`，以及具備上下文裝配、control plane、持久化 task record 與瀏覽器/檔案沙箱的 `createHarness()` durable runtime |
| `@zauso-ai/capstan-cron` | 定時排程套件：`defineCron`、`createCronRunner`、`createBunCronRunner`、`createAgentCron` |
| `@zauso-ai/capstan-ops` | 語義化運維核心：事件、事故、快照、查詢、SQLite 持久化 |
| `@zauso-ai/capstan-react` | SSR + loader、版面配置、`Outlet`、選擇性水合、ISR 渲染策略、`<Link>` SPA 路由（預取 + View Transitions）、`Image`、`defineFont`、`defineMetadata`、`ErrorBoundary` |
| `@zauso-ai/capstan-dev` | 開發伺服器，含檔案監看、即時路由重新載入、MCP/A2A 端點 |
| `@zauso-ai/capstan-cli` | CLI：`dev`、`build`、`start`、`deploy:init`、`verify`、`ops:*`、`add`、`mcp`、`db:*` |
| `create-capstan-app` | 專案鷹架工具（`--template blank`、`--template tickets`） |


---

## 🧑‍💻 參與貢獻

Capstan 目前為 `v1.0.0-beta.7`。歡迎參與貢獻！

```bash
git clone https://github.com/barry3406/capstan.git
cd capstan
bun install
bun run build        # 建置全部 workspace 套件
bun run test:new     # 執行完整倉庫測試套件
```

### 開發慣例

- 僅使用 ESM，匯入路徑須加上 `.js` 副檔名
- 嚴格 TypeScript（`exactOptionalPropertyTypes`、`verbatimModuleSyntax`）
- 所有 API 處理器皆使用 `defineAPI()` 搭配 Zod schema
- 寫入端點必須引用 `policy`

### 歡迎協助

- 更多鷹架範本（除 `blank` 與 `tickets` 之外）
- 更多整合測試與端對端測試
- 更多 OAuth 提供者（Google 與 GitHub 之外的）
- 更多部署適配器（AWS Lambda、Deno Deploy）

---

## 📝 授權條款

[MIT](LICENSE)

---

<div align="center">

**⚓ Capstan** — 同時說人話與機器語言的 API。

[立即開始](#-快速開始) · [文件](#-文件) · [GitHub](https://github.com/barry3406/capstan) · [回報問題](https://github.com/barry3406/capstan/issues)

</div>
