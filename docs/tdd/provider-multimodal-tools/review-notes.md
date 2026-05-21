# Review Notes — provider-multimodal-tools

Reviewers: **GPT-5.4** (codex/cocode proxy) and **Gemini** via zenmux.
**Deviation:** the plan's intended Gemini model (`gemini-3.1-pro-preview`) is not in
the zenmux subscription plan (HTTP 404, pay-as-you-go required). Probed available
models; only `google/gemini-3.5-flash` returns 200. Using **gemini-3.5-flash** as
the second reviewer for all rounds. `~/.claude/.env` `GEMINI_MODEL` updated
accordingly.

---

## STAGE 1 — Test-case review

### Round 1

#### GPT-5.4 (verbatim)
1. I-OA-LOOP-TOOLS-01, I-OA-LOOP-IMG-01, I-AN-LOOP-TOOLS-01, I-AN-LOOP-IMG-01, E2E-LOOP-01 — runSmartLoop prefers provider.stream when it exists; tests mock non-streaming JSON so they won't exercise the native chat() path. Force non-streaming: spread provider with `stream: undefined`. Add note to §2.
2. I-OA-LOOP-TOOLS-01, I-OA-LOOP-IMG-01, E2E-LOOP-01 — wire-format: use real `{choices:[{message:{...},finish_reason}]}` bodies, not `{content,finish_reason}` shorthand.
3. I-AN-LOOP-TOOLS-01 — pin real Anthropic `{content:[{type:"tool_use",...}],stop_reason:"tool_use"}` and call-2 `{content:[{type:"text"...}],stop_reason:"end_turn"}`.
4. Open-Q1/S-03/coverage — decide v1: native tools only on non-streaming chat(); stream() MUST stay text-only and omit options.tools. Replace S-03 with concrete stream tests: U-OA-STREAM-TOOLREQ-01, U-AN-STREAM-TOOLREQ-01 (stream omits tools), U-AN-STREAM-01 (real SSE text events → chunks).
5. U-AN-TOOLREQ-* — add U-AN-TOOLREQ-03: Anthropic omits tools when options.tools absent/empty.
6. A-OA-01 — deterministic oracle: bad-JSON arguments → `args:{}`, content "", tool runs once with {}, no crash.
7. E2E-LOOP-02 — vision-on-artifact is a proxy; instead assert turn-2 image_url bytes' sha256 === artifact sha256 and PNG signature; server-side hash, no Gemini step.
8. M-CONFIG/M-RUN — command `bun test tests/unit`; threshold high:90 break:85.

#### Gemini 3.5-flash (verbatim)
1. **Wire-format (tool RESULTS omitted):** plan never serializes tool *results* back. OpenAI needs `{role:"tool", tool_call_id, content}`; Anthropic needs `{role:"user", content:[{type:"tool_result", tool_use_id, content}]}`. Add contract + U-OA-TOOLRESP-03 / U-AN-TOOLRESP-03.
2. **U-LOOP-NATIVE-03 precedence:** empty-but-defined `toolCalls:[]` should SUPPRESS text parsing (record count 0), not fall back — else hallucinated text-JSON from a native provider could execute. Only `undefined` falls back.
3. Add U-AN-STREAM-01 (Anthropic SSE text_delta parsing).
4. **Streaming native-tools conflict:** if loop passes options.tools to stream(), providers serialize them, model returns native deltas that the text stream-parser can't handle → breakage. Pin stream() ignores options.tools. Add U-OA-STRM-TOOLS-01 / U-AN-STRM-TOOLS-01.
5. Add U-AN-TOOLREQ-03 (Anthropic tool omission) — same as GPT #5.
6. **Stryker monorepo trap:** tests import `@zauso-ai/capstan-agent` (→ dist), so mutating `packages/agent/src/llm.ts` won't be exercised. Tests must import providers via relative src path.
7. E2E-LOOP-02 — vision-on-artifact is a proxy; prefer a full-loop test where the model extracts a unique token from the image, proving serialize→transmit→understand.

### Round-1 convergence (fold in, no controversy)
- Force non-streaming in native-chat integration tests via `stream:undefined` (GPT#1).
- Fix integration/e2e mock bodies to real wire shapes (GPT#2/#3).
- Add U-AN-TOOLREQ-03 (both reviewers #5).
- Add Anthropic SSE stream parse test U-AN-STREAM-01 (both #3/#4).
- Add "stream() omits options.tools" guards U-OA-STRM-TOOLS-01 / U-AN-STRM-TOOLS-01 (both #4).
- A-OA-01 deterministic `args:{}` (GPT#6).
- Stryker: relative-src imports for mutated-file tests + threshold high:90/break:85, command `bun test tests/unit` (Gemini#6 + GPT#8).
- Add tool-RESULT serialization contract + tests U-OA-TOOLRESP-03 / U-AN-TOOLRESP-03 (Gemini#1) — see DECISION-2 for how far.

### Round-1 DISAGREEMENTS + my decisions (architect is tie-breaker)
**DECISION-1 — empty `toolCalls:[]` semantics.** GPT#: fall back to text. Gemini#2: suppress text.
→ **Adopt Gemini.** Rule: `response.toolCalls === undefined` ⇒ text provider ⇒ `parseToolRequests(content)`. `response.toolCalls` *defined* (even `[]`) ⇒ native provider spoke ⇒ use it verbatim; `[]` means "no tool calls this turn" ⇒ treat content as final answer, NO text parse. Safer (blocks hallucinated-JSON execution) and gives a clean text-vs-native provider signal. Rewrite U-LOOP-NATIVE-03 to assert record count 0.

**DECISION-2 — tool-RESULT transcript linkage (the deep one).** The loop appends tool results as plain `user` text messages and does NOT echo structured assistant `tool_calls`/`tool_use` back. Because nothing dangling is echoed, neither API 400s — so full `role:"tool"`/`tool_result` id-linkage is NOT required for correctness in v1. It IS a fidelity improvement (model sees its own structured calls). 
→ **v1 scope:** providers MUST still accept and correctly serialize a `tool`-role message and a `tool_result` content part IF present (so a future loop change works and so we don't 400 if one appears), and we ADD U-OA-TOOLRESP-03 / U-AN-TOOLRESP-03 at the provider layer. But the loop itself keeps text tool-results in v1 (documented non-goal: structured transcript linkage). RFC records this explicitly.

**DECISION-3 — streaming + native tools (PIVOTAL; loop always streams when stream exists).** Reviewers' "native tools on chat() only" leaves OpenAI native tools as dead code (openaiProvider has stream ⇒ loop streams). Three ways forward:
  (A) accumulate native tool-call deltas in the STREAM path (OpenAI delta.tool_calls; Anthropic input_json_delta) and surface via terminal-chunk toolCalls → preserves streaming, fully wires OpenAI, most work, touches WIP streaming-executor most;
  (B) loop prefers chat() when options.tools is non-empty → simple, but disables token-streaming for ~all agent turns (behavior regression);
  (C) multimodal-only now (both chat+stream), defer native tools → lowest risk, delivers the vision unblock.
→ **Escalating to the user** — newly-discovered fork that materially changes scope and touches their active WIP. (Recorded; resolution pending answer.)

**DECISION-4 — E2E oracle.** GPT#7: wire sha256 equality (deterministic). Gemini#7: model reads a token (true e2e). Skill mandates a Gemini-vision oracle.
→ **Combine:** E2E-LOOP-01 = full loop ↔ local mock server that base64-decodes the inbound image, asserts PNG signature + sha256 == artifact sha256 (deterministic wire proof). E2E-LOOP-02 = run `ask-gemini.sh -i` on the SAME real artifact with a token-bearing page, assert Gemini reads the token (satisfies the skill's vision-oracle mandate + proves the artifact is a real rendered page). Both kept.

**DECISION-3 RESOLVED** (user chose, via AskUserQuestion): **stream-aware native tools** — accumulate tool-call deltas in the stream path and surface via terminal `chunk.toolCalls`; `chat()` also supports native; multimodal in BOTH paths. test-cases v2 updated accordingly.

### Round 2
**Gemini deviation:** zenmux returned HTTP 402 `quote_exceeded` (subscription quota for the rolling window exhausted). gemini-3.5-flash unavailable this round. Proceeded with **GPT-5.4 as sole reviewer for round 2**; will retry Gemini at round 3. Recorded per skill "hard external blocker" clause.

#### GPT-5.4 (verbatim, 7 findings — all accepted, no disagreements)
1. **U-OA-TOOLRESP-02 unsafe under D1.** Split into Case A (`options.tools` absent ⇒ `toolCalls===undefined`) + Case B (tools present, no calls ⇒ `toolCalls===[]`, content preserved). Add **U-AN-TOOLRESP-04** (same A/B for Anthropic). → the provider's undefined-vs-[] signal is keyed on whether tools were advertised.
2. **Stream-path D1 untested.** Add U-OA-STREAM-TOOLS-03 / U-AN-STREAM-TOOLS-03 (terminal `chunk.toolCalls:[]` when tools present, no calls) + U-LOOP-STREAM-NATIVE-02 (terminal `[]` suppresses text parse).
3. **Double-dispatch has no regression test.** Add U-LOOP-STREAM-NATIVE-03: concurrency-safe `echo` with execution counter; mid-stream text JSON parseable THEN terminal native toolCalls; assert execute count===1, one record, uses native args.
4. **Multi-index accumulation missing.** Add U-OA-STREAM-TOOLS-02 / U-AN-STREAM-TOOLS-02 (two interleaved tool calls by index; guards against a single global accumulator).
5. **Anthropic stream tests too abstract.** Rewrite contract + U-AN-STREAM-01 / U-AN-STREAM-TOOLS-01 to explicit `event:`/`data:` SSE frames with top-level `type`/`index`; ignore `message_start`/`content_block_stop`/`ping`.
6. **Transport-level fragmentation untested.** Add A-STREAM-04 (OpenAI `data:` frame split across ReadableStream enqueues) / A-STREAM-05 (Anthropic frame fragmentation).
7. **Anthropic chat native-tools integration missing.** Add I-AN-CHAT-TOOLS-01 (stream:undefined, real `tool_use`/`stop_reason` bodies).

All 7 folded into test-cases v3. No reviewer disagreements this round (single reviewer).

### Round 3 (final)
**Gemini:** retried, HTTP 402 again (quota window not refreshed). GPT-5.4 sole reviewer.

#### GPT-5.4 (verbatim, 3 finalizing findings — all accepted)
1. Resolve `RFC-pending items` → **Locked implementation notes**: pin `LLMStreamChunk` terminal `toolCalls?`+`finishReason?` surface and the agent-local type mirror shapes (incl. `tool` role + `tool_result` part).
2. Add **S-TYPE-01** compile-only type-compat guard (`tests/types/llm-compat.ts`, `tsc --noEmit`).
3. Pin Anthropic **stream request** shape (`stream:true`, `max_tokens` default 4096, `system` hoisting, exclude `role:"system"` from `messages[]`) + rewrite U-AN-STREAM-01 to assert it.

**Architect refinement (tie-break on GPT#1/#2):** GPT said "bidirectional structural assignability." That is **wrong** here — `agent.LLMMessage` is intentionally WIDER (adds `tool` role + `tool_result` part that the v1 loop never emits). Required assignability is **one-directional**: the provider object must satisfy `ai.LLMProvider` (⇒ `ai.LLMMessage`→`agent.LLMMessage` for inputs, `agent` outputs→`ai`). S-TYPE-01 worded accordingly. Recorded as the round-3 disagreement+decision.

## STAGE 1 — 🔒 LOCKED. test-cases.md v3 final. ~50 tests across 6 categories.
Convergence signal: round 3 produced only design-locking refinements, no new defects.
**Process deviation (recorded):** Gemini (gemini-3.5-flash) available round 1 only; rounds 2–3 GPT-5.4-only due to zenmux quota (HTTP 402). GPT-5.4 reviews were thorough and convergent.
