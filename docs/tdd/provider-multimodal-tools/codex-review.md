# Stage 4 — Code Review Triage

**Reviewer:** GPT-5.4 via `ask-gpt.sh` proxy. **DEVIATION:** the codex CLI was
unavailable in this environment (401 Missing bearer / TLS-EOF to api.openai.com —
codex login not configured), so the final review ran through the working GPT-5.4
proxy (the same model `~/.codex/config.toml` targets). Recorded per the skill's
hard-external-blocker clause.

## Findings + decisions

1. **OpenAI stream drops the last buffered `data:` line at EOF (no trailing newline).** `agent/src/llm.ts` OpenAI `stream()` line-buffers on `\n` and never flushes residual `buf` after the read loop — a final `finish_reason`/`tool_calls`/`[DONE]` without a trailing newline is lost.
   → **ACCEPT.** Real robustness bug in code we touched. Flush residual buffer after the read loop before emitting the terminal chunk.

2. **Post-stream concurrent dispatch may start tools that an earlier result should have blocked/halted.** `streaming-executor.ts` routes deferred concurrency-safe tools via `dispatcher.dispatch(...)` and waits afterward; a tool could start before an earlier one sets `blockedApproval`/`hardFailureDetected`.
   → **INVESTIGATE → decision below.** The existing "blocked approval during concurrent execution stops all subsequent tools" test passes on the deferred path, so single-block works. Verified the two-phase (serial beforeToolCall hooks, then parallel execute) is preserved; concurrency-safe tools running in parallel is by-design (they don't gate each other). Treating as **NOT a regression** for concurrency-safe tools; the serial/write path already halts. Keeping behavior, adding no risky change. (If finding 3's capability-gate is adopted, the legacy eager path is also untouched.)

3. **`deferDispatch` keyed on "tools supplied" not "native-capable provider"** → regresses custom plain-text streaming providers (they now wait until EOS instead of mid-stream eager dispatch). Broader than the locked note.
   → **ACCEPT (adopt cleaner gate).** Add an explicit provider capability `nativeToolCalls?: "terminal"` to `LLMProvider` (both packages); set it on `openaiProvider`/`anthropicProvider`; gate `deferDispatch = llm.nativeToolCalls === "terminal" && toolSpecs.length > 0`. This removes the documented latency regression for text-only providers and makes the gate precise. Update stream-path loop test fakes to set the flag.

4. **`extractLeadingJson` can execute tools from inline prose/examples** (e.g. "To call the tool, send {...}").
   → **REJECT (out of scope) — surface to user.** `extractLeadingJson` is the user's pre-existing WIP, with the user's own new tests asserting "JSON preceded by prose extracts." Changing it conflicts with their explicit intent and is outside this feature (native tools + multimodal). Flagged to the user as a real safety consideration for their WIP; not modified here.

5. **OpenAI stream tests can't catch the EOF bug (`sseStream()` always appends `\n`).**
   → **ACCEPT.** Add a regression test using a raw stream whose final frame has NO trailing newline; assert one correct terminal chunk. (Pairs with fix #1.)

## Actions
- Fix #1 (llm.ts EOF flush) + #5 (raw-stream test).
- Adopt #3 (provider `nativeToolCalls` capability gate) across types (both pkgs), providers, executor, + test-fake updates.
- #2: no change (verified not a regression). #4: surfaced to user, not changed.
- Re-run full feature battery + mutation after fixes.

## Resolution (applied + re-verified) ✅
- **#1 fixed** — `agent/src/llm.ts` OpenAI `stream()` refactored: shared `handleLine` generator + EOF residual flush (`buf += decoder.decode(); process tail; single finalChunk`). Anthropic stream already flushed residual (llm.ts:674-680) — no change needed.
- **#5 fixed** — added `OpenAI stream() EOF without trailing newline` describe with EOF-01 (final tool-call frame) + EOF-02 (final `[DONE]`), using the `rawStream` helper (no trailing newline). Both assert exactly one terminal chunk.
- **#3 adopted** — `LLMProvider.nativeToolCalls?: "terminal"` added in `ai/src/types.ts` and the `agent/src/llm.ts` mirror; set on both bundled providers; executor gate now `llm.nativeToolCalls === "terminal" && tools?.length`. Text-only providers keep mid-stream eager dispatch (regression eliminated; existing streaming-parallel tests stay on the eager path). `streamLLM` test fake sets the flag.
- **#2** — no change (concurrency-safe parallelism is by-design; the single-block approval test passes on the deferred path).
- **#4** — surfaced to user; `extractLeadingJson` is their WIP with their own asserting tests; not modified.
- **Re-verification:** both packages `tsc` clean; build clean; feature battery **128 pass / 0 fail** (incl. 2 new EOF tests); S-TYPE-01 compat clean; mutation **8/8** killed (re-run after fixes); full suite **5130 pass / 15 fail** — identical 15 pre-existing failures, none in feature/adjacent files.
