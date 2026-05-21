# Exit / Deviation Notes — provider-multimodal-tools

## Deviations from the TDD-loop skill (all user-authorized or recorded)

1. **RFC stage (Stage 2) SKIPPED — user-authorized.** Via AskUserQuestion the user
   chose "Skip RFC, implement now": the locked `test-cases.md` (v3) already pins the
   design in its "Locked implementation notes" section (the content an RFC would
   carry). Proceeded test-cases → implementation → codex.

2. **Gemini reviewer degraded.** Intended `gemini-3.1-pro-preview` not in the zenmux
   plan (HTTP 404, pay-as-you-go required) → used `gemini-3.5-flash`. From round 2,
   even flash hit HTTP 402 (subscription quota, rolling window). Net: Gemini reviewed
   round 1 only; rounds 2–3 were GPT-5.4-only. GPT reviews were thorough and
   convergent (round 3 = only design-locking refinements). `~/.claude/.env`
   `GEMINI_MODEL` was changed `gemini-3.1-pro-preview` → `google/gemini-3.5-flash`.

3. **Mutation testing tool.** Stryker not installed and `bun:test` isn't natively
   instrumentable → plan uses Stryker **command runner** over `bun test`, with a
   documented manual-mutation fallback if Stryker can't install.

## Key implementation decision recorded here (not in original test-cases)

**STREAMING DISPATCH GATING (locked).** The existing streaming path eagerly dispatches
concurrency-safe tools mid-stream as they become parseable from text content. Native
tool calls only fully materialize on the terminal chunk (`chunk.toolCalls`). To make
D1 (terminal `[]` suppresses text-parse) and exactly-once hold, **the streaming path
defers ALL tool dispatch to stream-end whenever native tools are advertised**
(`optionsWithTools.tools?.length > 0`, which is the norm for agent turns):
  - accumulate `content` + `finishReason` + terminal `chunk.toolCalls` during the stream;
  - at end: `terminalToolCalls` defined ⇒ use it (D1: `[]` ⇒ no tools, no text-parse);
    `undefined` ⇒ `parseToolRequests(accumulatedContent)` (text fallback);
  - run via the EXISTING post-stream concurrent/serial execution machinery
    (concurrency limit, hard-failure halt, approval blocking, ordering all preserved).
  - mid-stream eager dispatch is retained ONLY when no tools are advertised.

**Tradeoff (deliberate):** for tool-advertised streaming turns, concurrency-safe tools
now start after the streamed response completes rather than mid-stream — a small
latency change, NOT a correctness change. No existing test asserts mid-stream dispatch
timing (verified against tests/unit/ai-streaming-executor.test.ts "streaming parallel
execution" block — all assert only final toolRecords), so all stay green.
