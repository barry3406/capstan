# Evidence — provider-multimodal-tools

## Typecheck
- `tsc -p packages/agent/tsconfig.json --noEmit` → clean.
- `tsc -p packages/ai/tsconfig.json --noEmit` → clean.
- `npm run build` → 12 workspaces built successfully.

## Unit + integration + smoke + adversarial (the feature's battery)
- `bun test` on the 5 feature files (llm-native, streaming-executor-native, integration, + existing llm.test.ts, ai-streaming-executor.test.ts) → **125 pass / 0 fail** (274 expect calls).
- New tests: `tests/unit/llm-native.test.ts` (39), `tests/unit/streaming-executor-native.test.ts` (9), `tests/integration/llm-loop-native.test.ts` (6), `tests/types/llm-compat.ts` (S-TYPE-01, compile-only).
- Existing backward-compat suites stay green unchanged: `llm.test.ts` 26/26, `ai-streaming-executor.test.ts` 41/41.

## E2E
- **E2E-LOOP-01** (`tests/e2e/provider-multimodal-tools.test.ts`): full `runSmartLoop` ↔ in-test `Bun.serve` mock; mock base64-decodes the inbound `image_url`, asserts PNG signature + `sha256(decoded)==sha256(artifact)`, returns completion. → **1 pass / 5 expect**. This is the load-bearing e2e for a serialization feature: it proves the screenshot bytes reach the model wire request byte-exact.
- **E2E-LOOP-02** (Gemini-vision oracle): **DEVIATION — blocked.** zenmux quota (HTTP 402) for Gemini persisted through the run; the vision oracle could not be executed. Mitigation: E2E-LOOP-01's deterministic byte/hash proof covers the feature's correctness; the vision step can be run once quota refreshes (`ask-gemini.sh -i <artifact> ...`).

## Mutation (manual fallback — Stryker not installed; bun:test not natively instrumentable)
8 targeted operators hand-applied to the two mutated files, each run against the src-importing green test set (llm-native, streaming-executor-native, integration, ai-streaming-executor); baseline rc=0:

| # | mutation | result | killer |
|---|----------|--------|--------|
| M1 | OpenAI `type:"image_url"` → `"image_xx"` | KILLED | U-OA-IMG-01 |
| M2 | OpenAI data-url `;base64,` → `;base64;` | KILLED | U-OA-IMG-01 |
| M3 | Anthropic `media_type` → `mediatype` | KILLED | U-AN-IMG-01 |
| M4 | OpenAI `tool_choice="auto"` → `"none"` | KILLED | U-OA-TOOLREQ-01 |
| M5 | Anthropic `input_schema` → `inputSchema` | KILLED | U-AN-TOOLREQ-01 |
| M6 | chat `response.toolCalls !== undefined` → `=== undefined` | KILLED | U-LOOP-NATIVE-01 |
| M7 | stream defer gating `> 0` → `< 0` | KILLED | U-LOOP-STREAM-NATIVE-02 |
| M8 | stream `terminalToolCalls !== undefined` → `=== undefined` | KILLED | U-LOOP-STREAM-NATIVE-01 |

**Mutation score: 8/8 (100%)** on targeted operators. Files restored pristine (post-run tsc clean).

## Full repo suite (regression check)
- `npm test` → **5128 pass / 15 fail** across 247 files.
- **All 15 failures are PRE-EXISTING — none introduced by this feature** (my implementers touched only `packages/agent/src/llm.ts`, `packages/agent/src/index.ts`, `packages/ai/src/types.ts`, `packages/ai/src/loop/streaming-executor.ts` + new test files). Attribution:
  - 6 — `ai-smart-agent` / `createToolCatalog`: user WIP changed `DEFAULT_DEFER_THRESHOLD` 15→64 (`tool-catalog.ts`, not touched here); tests assert old threshold.
  - 2 — `harness-tools`: user WIP added browser_snapshot/press/wait/url/get_text (`harness/runtime/tools.ts`, not touched here); tests assert old tool list/order.
  - 1 — `adversarial-llm` "nested JSON that looks like tool call but isn't": user WIP `extractLeadingJson` intentionally extracts JSON after prose (user's own new tests assert this); the older adversarial test now contradicts it.
  - 2 — `route-middleware`: pre-existing error-message mismatch (dev package, not touched).
  - 3 — `client-router` Link/scroll: pre-existing (react package, not touched).
  - 1 — `db-provider-integration`: pre-existing slow integration (db package, not touched).
- These belong to the user's in-progress WIP / unrelated areas and were intentionally NOT modified by this feature work.

## Stage 4 — code review fixes applied & re-verified
GPT-5.4 review (codex CLI was auth-blocked in this env — see codex-review.md) raised 5 findings; 1/3/5 accepted+fixed, 2 verified-not-a-regression, 4 surfaced as out-of-scope WIP. After fixes:
- typecheck (agent+ai) clean; `npm run build` clean.
- feature battery: **128 pass / 0 fail** (added EOF-01/EOF-02 regression tests for the OpenAI stream EOF flush).
- mutation: **8/8 killed** (re-run after the capability-gate change — M7 still killed).
- full suite: **5130 pass / 15 fail** — same 15 pre-existing failures, none in feature/adjacent files.

## Exit status
test-cases.md LOCKED ✅ · RFC skipped (user-authorized) ✅ · feature battery green ✅ · mutation 8/8 ✅ ·
review findings resolved/argued ✅. Deferred: E2E-LOOP-02 Gemini-vision oracle (zenmux quota 402).

## Comprehensive stabilization (user asked to "fix everything in one pass")
The user confirmed their prior WIP was rough and asked to get the whole tree correct + green + committed.
Resolved ALL 15 full-suite failures:
- AI WIP reconciled: tool-catalog inline threshold 15→64 (tests updated); harness browser toolset gained
  browser_snapshot/press/wait/url/get_text + browser_screenshot now returns an inline image by default
  (tests updated, toMatchObject); `extractLeadingJson` tightened to EDGE-ANCHORED extraction (leading/trailing
  prose OK, mid-buried JSON examples no longer mis-fire) and the adversarial test repurposed to the mid-buried case.
- react: a REAL bug — `scroll:false` fired a redundant `window.scrollTo` (regression from 9e94aed); fixed in
  packages/react/src/client/router.ts (3 tests green).
- dev: stale middleware-export error-message assertions updated to the current (clearer) message (2 tests).
- db: integration test's Docker skip predicate tightened to also require host-arch-runnable images
  (mysql:5.7 has no arm64 manifest) → skips gracefully (2 skip) instead of failing.
- **Full suite after stabilization: 5144 pass · 2 skip · 0 fail.** Mutation re-run after the parser change: 8/8.
