# Test Cases — Provider Multimodal + Native Function-Calling

**Feature slug:** `provider-multimodal-tools`
**Status:** 🔒 LOCKED v3 (3 review rounds complete; incorporates DECISIONS 1–4 + locked implementation notes)

## Feature summary

Wire two capabilities end-to-end while preserving the existing **text-based**
tool-call path:

1. **Multimodal images reach the model**, on BOTH the `chat()` and `stream()`
   paths of both bundled providers (`packages/agent/src/llm.ts`). The loop
   always streams when a provider has `stream()`, so multimodal serialization
   MUST work while streaming.
2. **Stream-aware native function-calling.** When `options.tools` is supplied,
   providers advertise them natively AND parse structured tool calls back —
   from the non-streaming `chat()` response, and by **accumulating streamed
   tool-call deltas** during `stream()` and surfacing them on the terminal
   chunk. The loop consumes native tool calls (precedence) and falls back to
   `parseToolRequests(content)` only when the provider returned **no** native
   tool-call signal at all.

### Locked decisions (see review-notes.md for rationale)
- **D1 — empty native tool calls suppress text parse.** `toolCalls`/terminal
  `chunk.toolCalls` *undefined* ⇒ text provider ⇒ `parseToolRequests(content)`.
  *Defined* (even `[]`) ⇒ native provider spoke ⇒ use verbatim; `[]` ⇒ final
  answer, **no** text parse.
- **D2 — tool-result serialization.** Providers must serialize a `tool`-role
  message (OpenAI) / `tool_result` content part (Anthropic) when present, so the
  transcript is API-valid. The loop keeps text tool-results in v1 (structured
  transcript linkage is a **non-goal**, documented in RFC).
- **D3 — stream-aware native tools** (chosen). Both `chat()` and `stream()`
  send `options.tools` and round-trip native calls.
- **D4 — E2E** = deterministic wire hash-equality (mock server) + Gemini-vision
  token read on the real artifact.

### Hard invariant (backward compatibility)
When `options.tools` is absent AND the provider emits no native tool-call signal,
behavior is byte-for-byte today's. Every existing test in
`tests/unit/llm.test.ts` and `tests/unit/ai-streaming-executor.test.ts` stays
green unchanged.

### Test-resolution rule (fact (b))
Package-name imports resolve to built `dist`. New tests that must exercise
**source** (and be mutated by Stryker) import providers/loop via **relative src
path** (`../../packages/agent/src/llm.ts`, `../../packages/ai/src/loop/...`).
Existing dist-based tests are validated by running `npm run build` before the
final battery.

## Wire-format contracts (the oracle reference)

**OpenAI** `/chat/completions`
- image part → `{type:"image_url", image_url:{url:"data:<mediaType>;base64,<data>"}}`; text part → `{type:"text", text}`
- tool-result message → `{role:"tool", tool_call_id:<id>, content:<string>}`
- request tools → `body.tools=[{type:"function",function:{name,description,parameters}}]`, `body.tool_choice="auto"`
- non-stream response calls → `choices[0].message.tool_calls=[{id,type:"function",function:{name,arguments:"<JSON string>"}}]`, `finish_reason:"tool_calls"`
- **stream** tool deltas → repeated `choices[0].delta.tool_calls=[{index,id?,function:{name?,arguments?:"<partial>"}}]`; accumulate by `index` (id+name from first delta, `arguments` concatenated), parse JSON at stream end; `finish_reason:"tool_calls"` on final delta.

**Anthropic** `/messages`
- image part → `{type:"image", source:{type:"base64", media_type:<mediaType>, data:<data>}}`; text part → `{type:"text", text}`
- tool-result message → `{role:"user", content:[{type:"tool_result", tool_use_id:<id>, content:<string>}]}`
- request tools → `body.tools=[{name,description,input_schema:parameters}]`
- non-stream response calls → `content:[{type:"tool_use", id, name, input:{...}}]`, `stop_reason:"tool_use"`
- **stream request** — POST `${baseUrl}/messages`, same headers as chat; body MUST include `stream:true`, `max_tokens` (default `4096` when `options.maxTokens` absent), top-level `system` when a system message/prompt is present, and `messages[]` excluding any `role:"system"` entries; tools sent when `options.tools` present (D3).
- **stream response** — real SSE frames: `event:` + `data:` line pairs separated by blank lines, parsed from a buffer (frames may fragment across transport reads). Text → `event: content_block_delta` / `data:{"type":"content_block_delta","index":N,"delta":{"type":"text_delta","text":"..."}}`. Tool calls → `event: content_block_start` / `data:{"type":"content_block_start","index":N,"content_block":{"type":"tool_use","id","name"}}` then `content_block_delta` with `delta:{"type":"input_json_delta","partial_json":"..."}`; accumulate `partial_json` per `index`, parse at end. Finish reason on `event: message_delta` (`delta.stop_reason`); terminalize on `event: message_stop`. Ignore benign `message_start`, `content_block_stop`, `ping`.

**Loop mapping:** `LLMResponse.toolCalls?: {id:string;name:string;args:Record<string,unknown>}[]`; terminal `LLMStreamChunk` carries `toolCalls?` same shape. `executeModelAndTools` maps each → `ToolRequest{id,name,args,order:index}`.

---

## 1. Unit tests

Isolation: only `globalThis.fetch` mocked (existing file style); loop-mapping
units use a fake `LLMProvider`. New tests import via relative src path.

### 1a. Multimodal serialization — chat()
- **U-OA-IMG-01** — OpenAI chat serializes text+image → `image_url`. act `chat([{role:"user",content:[{type:"text",text:"look"},{type:"image",mediaType:"image/png",data:"AAAB"}]}])`; assert `body.messages[0].content` deep-equals `[{type:"text",text:"look"},{type:"image_url",image_url:{url:"data:image/png;base64,AAAB"}}]`.
- **U-OA-IMG-02** — OpenAI chat leaves string content untouched (regression). assert `body.messages[0]` deep-equals `{role:"user",content:"hello"}`, `typeof content==="string"`.
- **U-AN-IMG-01** — Anthropic chat serializes → `image.source.base64`; `mediaType:"image/jpeg"` to prove mapping. assert content `[{type:"text",text:"look"},{type:"image",source:{type:"base64",media_type:"image/jpeg",data:"ZZZ"}}]`.
- **U-AN-IMG-02** — Anthropic chat string content untouched (regression).
- **U-AN-IMG-03** — Anthropic system stays top-level string; user multimodal array preserved. assert `body.system==="sys"`, `body.messages.length===1`.

### 1b. Multimodal serialization — stream() (D3: must work while streaming)
- **U-OA-STREAM-IMG-01** — OpenAI `stream()` serializes a text+image message to `image_url` in the request body. arrange capture body, return a one-chunk SSE text stream; act consume `stream([{role:"user",content:[{type:"text",text:"x"},{type:"image",mediaType:"image/png",data:"Q"}]}])`; assert captured `body.messages[0].content` includes `{type:"image_url",image_url:{url:"data:image/png;base64,Q"}}` and `body.stream===true`.
- **U-AN-STREAM-IMG-01** — Anthropic `stream()` serializes image → `image.source.base64` in body.

### 1c. Native tools — request serialization
- **U-OA-TOOLREQ-01** — OpenAI chat advertises tools. assert `body.tools` deep-equals `[{type:"function",function:{name:"get_weather",description:"d",parameters:{...}}}]`, `body.tool_choice==="auto"`.
- **U-OA-TOOLREQ-02** — OpenAI chat omits tools/tool_choice when `options.tools` absent OR `[]` (regression). assert `"tools" in body===false` and `"tool_choice" in body===false` both cases.
- **U-AN-TOOLREQ-01** — Anthropic chat tools use `input_schema`. assert `body.tools` deep-equals `[{name:"x",description:"d",input_schema:{...}}]`.
- **U-AN-TOOLREQ-02** — Anthropic supplies default `input_schema:{type:"object",properties:{}}` when `parameters` missing.
- **U-AN-TOOLREQ-03** — Anthropic chat omits tools when `options.tools` absent OR `[]` (regression). assert `"tools" in body===false` both cases.
- **U-OA-STREAM-TOOLREQ-01** — OpenAI `stream()` DOES send `body.tools` + `tool_choice` when `options.tools` present (D3). assert present. *(inverts round-1 reviewers' "omit"; D3 chosen.)*
- **U-AN-STREAM-TOOLREQ-01** — Anthropic `stream()` DOES send `body.tools` when present.

### 1d. Native tools — response parsing (chat())
- **U-OA-TOOLRESP-01** — OpenAI parses `tool_calls` (arguments JSON string → object). arrange `choices:[{message:{content:null,tool_calls:[{id:"call_1",type:"function",function:{name:"get_weather",arguments:'{"city":"Paris"}'}}]},finish_reason:"tool_calls"}]`; assert `result.toolCalls` deep-equals `[{id:"call_1",name:"get_weather",args:{city:"Paris"}}]`, `result.content===""`, `result.finishReason==="tool_calls"`.
- **U-OA-TOOLRESP-02** — OpenAI no-call turn preserves the D1 sentinel. **Case A:** `options.tools` absent; body `{choices:[{message:{content:"hi"},finish_reason:"stop"}]}` ⇒ `result.toolCalls===undefined`, `content==="hi"`. **Case B:** `options.tools` present; same body ⇒ `result.toolCalls` deep-equals `[]`, `content==="hi"`, `finishReason==="stop"`. (Provider keys undefined-vs-`[]` on whether tools were advertised.)
- **U-AN-TOOLRESP-01** — Anthropic parses `tool_use` blocks. arrange `content:[{type:"text",text:"thinking"},{type:"tool_use",id:"tu_1",name:"get_weather",input:{city:"Paris"}}]`,`stop_reason:"tool_use"`; assert `content==="thinking"`, `toolCalls` deep-equals `[{id:"tu_1",name:"get_weather",args:{city:"Paris"}}]`, `finishReason==="tool_use"`.
- **U-AN-TOOLRESP-02** — existing "extract text" test stays green: `[{type:"text",text:"First block"},{type:"tool_use",id:"123"},{type:"text",text:"Second block"}]` ⇒ `content==="First block"`; malformed tool_use (no name/input) dropped from `toolCalls`, no throw (see A-AN-04).
- **U-AN-TOOLRESP-04** — Anthropic no-call turn preserves the D1 sentinel. **Case A:** `options.tools` absent; body `{content:[{type:"text",text:"hi"}],stop_reason:"end_turn"}` ⇒ `result.toolCalls===undefined`. **Case B:** `options.tools` present; same body ⇒ `result.toolCalls` deep-equals `[]`, `content==="hi"`, `finishReason==="end_turn"`.

### 1e. Tool-result serialization (D2)
- **U-OA-TOOLRESP-03** — OpenAI serializes a tool-result message. act `chat([{role:"tool",content:"ok",toolCallId:"call_1"}])`; assert `body.messages[0]` deep-equals `{role:"tool",tool_call_id:"call_1",content:"ok"}`. *(Defines the `tool`-role mapping; loop doesn't emit these in v1 but providers accept them.)*
- **U-AN-TOOLRESP-03** — Anthropic serializes a tool_result content part. act `chat([{role:"user",content:[{type:"tool_result",toolUseId:"tu_1",content:"ok"}]}])`; assert `body.messages[0].content` deep-equals `[{type:"tool_result",tool_use_id:"tu_1",content:"ok"}]`.

### 1f. Anthropic stream() — basic SSE (NEW method)
- **U-AN-STREAM-01** — Anthropic `stream()` sends the real request shape AND parses real text SSE frames. arrange capture URL/headers/body from `stream([{role:"system",content:"sys"},{role:"user",content:"hi"}])`; return frames `message_start`, `content_block_start`(text), two `content_block_delta` text deltas (`"Hello"`,`" world"`), `content_block_stop`, `message_delta`(`stop_reason:"end_turn"`), `message_stop`. assert URL ends `/messages`; headers include `x-api-key`, `anthropic-version:"2023-06-01"`, `Content-Type`; `body.stream===true`, `body.max_tokens===4096`, `body.system==="sys"`, `body.messages` deep-equals `[{role:"user",content:"hi"}]`; chunks `[{content:"Hello",done:false},{content:" world",done:false},{content:"",done:true,finishReason:"end_turn"}]`.

### 1g. Stream-aware native tool accumulation (D3)
- **U-OA-STREAM-TOOLS-01** — OpenAI `stream()` accumulates `delta.tool_calls` across chunks and yields a terminal chunk with `toolCalls`. arrange SSE deltas: index0 id+name+`arguments:""`, then `arguments:'{"msg":'`, then `arguments:'"hi"}'`, then `{delta:{},finish_reason:"tool_calls"}`, `[DONE]`; assert final chunk `done:true` and `chunk.toolCalls` deep-equals `[{id:"call_1",name:"echo",args:{msg:"hi"}}]`; earlier text chunks (if any) still yielded.
- **U-OA-STREAM-TOOLS-02** — OpenAI `stream()` accumulates MULTIPLE interleaved `delta.tool_calls` by `index` (guards against a single global accumulator). arrange deltas where indices 0 and 1 start, `id`/`name` only on first sighting of each, later deltas append `arguments` interleaved (1,0,1,0); final `finish_reason:"tool_calls"`, `[DONE]`. assert terminal `toolCalls` ordered by index deep-equals `[{id:"call_0",name:"echo",args:{a:1}},{id:"call_1",name:"sum",args:{b:2}}]`.
- **U-OA-STREAM-TOOLS-03** — OpenAI `stream()` with `options.tools` present but NO `delta.tool_calls` ⇒ text chunks + exactly one terminal `{content:"",done:true,finishReason:"stop",toolCalls:[]}`. assert `toolCalls===[]` (NOT `undefined`).
- **U-AN-STREAM-TOOLS-01** — Anthropic `stream()` accumulates `input_json_delta` (explicit `event:`/`data:` frames). arrange `content_block_start`(tool_use id:"tu_1",name:"echo"), two `content_block_delta`(`input_json_delta` `'{"msg":'` then `'"hi"}'`), `message_delta`(`stop_reason:"tool_use"`), `message_stop`; assert terminal chunk `toolCalls` deep-equals `[{id:"tu_1",name:"echo",args:{msg:"hi"}}]`.
- **U-AN-STREAM-TOOLS-02** — Anthropic `stream()` accumulates MULTIPLE interleaved `tool_use` blocks by top-level `index`. arrange two `content_block_start` (index 0,1) + alternating `input_json_delta` frames per index, `message_delta`(`tool_use`), `message_stop`; assert terminal `toolCalls` ordered by index deep-equals both calls with correct args.
- **U-AN-STREAM-TOOLS-03** — Anthropic `stream()` with `options.tools` present but no `tool_use` block ⇒ text deltas + terminal `{content:"",done:true,finishReason:"end_turn",toolCalls:[]}`. assert `toolCalls===[]` (NOT `undefined`).

### 1h. Loop outcome mapping — chat path (`streaming-executor.ts`)
- **U-LOOP-NATIVE-01** — `executeModelAndTools` builds toolRequests from `response.toolCalls` and executes. fake `chat`→`{content:"",model:"m",toolCalls:[{id:"call_1",name:"echo",args:{msg:"hi"}}]}` (fake llm has NO stream so chat path); tools `[echo]`. assert one record `tool:"echo"`,`result:{msg:"hi"}`,`status:"success"`; `outcome.finishReason==="tool_use"`.
- **U-LOOP-NATIVE-02** — native precedence over text in same response. `chat`→`{content:'{"tool":"echo","arguments":{"msg":"FROMTEXT"}}',toolCalls:[{id:"c1",name:"echo",args:{msg:"FROMNATIVE"}}]}`; assert exactly ONE record, arg `msg==="FROMNATIVE"`.
- **U-LOOP-NATIVE-03** (REVISED per D1) — empty-but-defined `toolCalls:[]` SUPPRESSES text parse. `chat`→`{content:'{"tool":"echo","arguments":{"msg":"hi"}}',toolCalls:[]}`; assert **zero** tool records (treated as final answer); `outcome.toolRequests.length===0`.
- **U-LOOP-TEXT-01** — `toolCalls` field absent ⇒ unchanged text path. `chat`→`{content:'{"tool":"echo","arguments":{"msg":"hi"}}'}`; assert one record, `msg==="hi"`.
- **U-LOOP-FINISH-01** — toolRequests non-empty ⇒ `outcome.finishReason==="tool_use"` regardless of provider string.

### 1i. Loop outcome mapping — stream path
- **U-LOOP-STREAM-NATIVE-01** — terminal `chunk.toolCalls` drives execution. fake llm with `stream()` yielding text chunks then `{done:true,toolCalls:[{id:"c1",name:"echo",args:{msg:"hi"}}]}`; tools `[echo]`. assert one `echo` record `result:{msg:"hi"}`; native takes precedence over any text-parsed content.
- **U-LOOP-STREAM-TEXT-01** — stream with NO `toolCalls` on any chunk (undefined) ⇒ text parse of accumulated content (regression). stream yields text forming `{"tool":"echo","arguments":{"msg":"hi"}}`, terminal chunk `{done:true}` (no toolCalls field); assert one record `msg==="hi"`.
- **U-LOOP-STREAM-NATIVE-02** (D1 on stream) — terminal `chunk.toolCalls:[]` SUPPRESSES text parse. stream yields text forming `{"tool":"echo","arguments":{"msg":"FROMTEXT"}}` then terminal `{content:"",done:true,toolCalls:[]}`; assert `outcome.toolRequests.length===0`, zero tool records.
- **U-LOOP-STREAM-NATIVE-03** (no double-dispatch) — concurrency-safe `echo` with an execution counter. stream: chunk1 `{content:'{"tool":"echo","arguments":{"msg":"FROMTEXT"}}',done:false}`, chunk2 `{content:"",done:false}`, terminal `{content:"",done:true,toolCalls:[{id:"c1",name:"echo",args:{msg:"FROMNATIVE"}}]}`. assert execute count===**1**, `toolRecords.length===1`, sole record uses `{msg:"FROMNATIVE"}` (native precedence; mid-stream text dispatch must not also fire).

---

## 2. Integration tests (real loop + real provider; only `fetch` mocked)

Real `openaiProvider`/`anthropicProvider` + real `runSmartLoop`. Both providers
have `stream()` after this change, so the DEFAULT path is streaming; a
`stream:undefined` spread covers the chat path too.

- **I-OA-STREAM-TOOLS-01** — streaming native tool call → completion. scripted SSE `fetch`: call 1 → tool-call deltas for `echo` + `finish_reason:"tool_calls"`; call 2 → text SSE `"done"` + stop. assert `status==="completed"`, `result.result==="done"`, an `echo` success record, call-1 body had `tools`.
- **I-OA-CHAT-TOOLS-01** — same with `llm:{...openaiProvider(...),stream:undefined}` → exercises chat() native path with `tool_calls` JSON bodies.
- **I-OA-STREAM-IMG-01** — a tool `shoot`→`{image:{mediaType:"image/png",base64:"AAAB"}}`; call 1 (SSE) tool-call for `shoot`; call 2 capture body→ assert it contains `{type:"image_url",image_url:{url:"data:image/png;base64,AAAB"}}`; return text "saw it". assert completes.
- **I-AN-STREAM-TOOLS-01** — Anthropic streaming `tool_use` round-trip to completion; call-1 body had `tools` with `input_schema`.
- **I-AN-STREAM-IMG-01** — Anthropic call-2 body contains `{type:"image",source:{type:"base64",media_type:"image/png",data:"AAAB"}}`.
- **I-AN-CHAT-TOOLS-01** — Anthropic chat native-tools path via `llm:{...anthropicProvider(...),stream:undefined}`. call 1 → `{content:[{type:"tool_use",id:"tu_1",name:"echo",input:{msg:"hi"}}],stop_reason:"tool_use"}`; call 2 → `{content:[{type:"text",text:"done"}],stop_reason:"end_turn"}`. assert `status==="completed"`, `result.result==="done"`, one `echo` success record, call-1 body had `tools` with `input_schema`.

---

## 3. Adversarial tests

- **A-OA-01** — chat `tool_calls[].function.arguments` invalid JSON (`"{not json"`). assert no throw; `toolCalls` deep-equals `[{id:"call_1",name:"get_weather",args:{}}]`; loop executes tool once with `{}`.
- **A-OA-02** — chat `tool_calls` entry missing/empty `function.name` ⇒ dropped from `toolCalls`; no empty-name ToolRequest reaches loop.
- **A-AN-04** — Anthropic `tool_use` block missing `name` (`{type:"tool_use",id:"123"}`) ⇒ dropped; content extraction unaffected; no throw.
- **A-STREAM-01** — OpenAI stream `arguments` JSON split across 3 chunks at awkward byte boundaries (e.g. `'{"ci'`, `'ty":"Par'`, `'is"}'`) accumulates to valid `{city:"Paris"}`. oracle: terminal `toolCalls[0].args` deep-equals `{city:"Paris"}`.
- **A-STREAM-02** — OpenAI stream interleaves text content deltas AND tool_call deltas; assert text is yielded as chunks AND terminal `toolCalls` present; loop uses native (precedence).
- **A-STREAM-03** — stream ends WITHOUT `finish_reason:"tool_calls"` but with a complete accumulated tool_call (provider quirk) ⇒ still surface `toolCalls` (accumulation, not finish_reason, is the trigger). *(guards over-fitting finish_reason.)*
- **A-IMG-01** — image part `data:""` ⇒ serialized as `...;base64,` (empty), no throw, message still sent.
- **A-IMG-02** — multimodal sibling text part `"价格 { } 确认"` serialized verbatim (unicode + braces; no corruption); image part intact.
- **A-IMG-03** — oversized image (~1.5 MB base64) with tiny `maxAggregateCharsPerIteration` is NOT truncated: base64 reaching captured provider body equals full input (byte-length equality).
- **A-MIX-01** — response text-JSON names tool A, native names tool B (distinct) ⇒ only B runs; record count 1.
- **A-TOOLREQ-01** — `options.tools[].name` with spaces forwarded verbatim (provider doesn't mangle); `body.tools[0].function.name` unchanged.
- **A-STREAM-04** — OpenAI SSE frame fragmented across TRANSPORT reads: split one logical `data: {...}\n\n` tool-call frame across 3 `ReadableStream` enqueues before the newline completes; final frame `finish_reason:"tool_calls"`, `[DONE]`. assert exactly one terminal done chunk with `toolCalls:[{id:"call_1",name:"echo",args:{msg:"hi"}}]`, no duplicate terminal chunk.
- **A-STREAM-05** — Anthropic SSE frame fragmented across transport reads: split `event:`/`data:` lines for `content_block_start`/`content_block_delta` across multiple enqueues; assert text/tool-use accumulation still succeeds and terminal `toolCalls` correct.

---

## 4. Smoke tests
- **S-01 / S-02** — `openaiProvider().name==="openai"`, `anthropicProvider().name==="anthropic"` (existing; keep).
- **S-03** — both providers expose a callable `stream` (anthropic NEW).
- **S-04** — string-only `chat([{role:"user",content:"ping"}])` round-trips `content:"pong"` for both (one assertion/provider — baseline no-regression).
- **S-TYPE-01** — compile-only type-compat guard (no drift between agent mirror and ai types). A `tests/types/llm-compat.ts` compiled by `tsc --noEmit` asserts the meaningful (one-directional) assignability: `const _p: aiTypes.LLMProvider = openaiProvider({apiKey:""})` and the anthropic equivalent typecheck; plus `ai.LLMMessage` → `agent.LLMMessage` (inputs) and `agent.LLMResponse`/`agent.LLMStreamChunk` → `ai` (outputs). oracle: tsc exit 0.

---

## 5. Mutation tests
- **M-CONFIG** — `@stryker-mutator/core`, **command runner**: `commandRunner.command:"bun test tests/unit"`. `mutate:["packages/agent/src/llm.ts","packages/ai/src/loop/streaming-executor.ts"]`. **Tests that target these must import the file via relative src path** (fact (b)) or mutation won't bite. threshold `high:90, break:85`.
- **M-RUN** — `npx stryker run` exits 0, killed ratio ≥ 85% on mutated files; survivors enumerated in evidence.md with justification or a new killing test.
- **M-FALLBACK** — if Stryker can't install (no registry / bun-runner incompat), record deviation and hand-mutate ≥8 operators, each caught by a named test: `image_url`→`image`; `media_type` key drop; `data:`→`data;`; remove `tool_choice` line; `??`→`&&` in native-vs-text precedence; `order:index`→`order:index+1`; accumulate `+=`→`=` for stream arguments; `toolCalls===undefined` flip (D1). List flip + catching test.

---

## 6. E2E test (D4)
- **E2E-LOOP-01** — full `runSmartLoop` ↔ local `Bun.serve` mock at `http://127.0.0.1:<port>/v1`. Streaming SSE: turn 1 → native tool-call deltas for a screenshot tool; turn 2 → mock base64-decodes the inbound `image_url` data URL, asserts PNG signature `89 50 4E 47 0D 0A 1A 0A` and `sha256(decoded)===sha256(artifact)`, then returns text "I can see the page". assert `status==="completed"`, final text matches, server logged the hash match. boot: in-test `Bun.serve`; no external service.
- **E2E-LOOP-02** — Gemini-vision oracle on the real artifact. arrange a token-bearing page (`<h1>Capstan TDD 7Q9Z</h1>`) rendered by `PlaywrightEngine` → screenshot → `docs/tdd/provider-multimodal-tools/artifacts/e2e-shot.png`. act `ask-gemini.sh -i <png> 'Reply JSON {"heading":string,"token":string,"notes":string}; ground in pixels.'`. assert `token` matches `/7Q9Z/` and `heading` matches `/capstan tdd/i`. Full reply pasted into evidence.md. note: if Playwright unavailable, deviation recorded; substitute a deterministic SVG→PNG render of the same token so the vision oracle still runs on a real image.

---

## Coverage claim (pre-code, 100% intent)

| Branch / path | Test |
|---|---|
| OA chat: string content | U-OA-IMG-02, S-04 |
| OA chat: part[] → image_url | U-OA-IMG-01, A-IMG-01/02/03 |
| OA stream: part[] → image_url | U-OA-STREAM-IMG-01, I-OA-STREAM-IMG-01 |
| OA request tools present / absent / [] | U-OA-TOOLREQ-01 / U-OA-TOOLREQ-02 |
| OA stream sends tools | U-OA-STREAM-TOOLREQ-01 |
| OA chat tool_calls valid / no-call sentinel A&B / bad-JSON / no-name | U-OA-TOOLRESP-01 / -02 / A-OA-01 / A-OA-02 |
| OA stream tool-delta accumulate / multi-index / empty[] / split-logical / interleave / no-finish / frag | U-OA-STREAM-TOOLS-01 / -02 / -03 / A-STREAM-01 / -02 / -03 / -04 |
| OA tool-result message | U-OA-TOOLRESP-03 |
| AN chat string vs part[] / system | U-AN-IMG-02 / U-AN-IMG-01 / U-AN-IMG-03 |
| AN stream part[] → image | U-AN-STREAM-IMG-01, I-AN-STREAM-IMG-01 |
| AN request tools (input_schema / default / absent) | U-AN-TOOLREQ-01 / -02 / -03 |
| AN stream sends tools | U-AN-STREAM-TOOLREQ-01 |
| AN chat tool_use parsed / malformed / no-call sentinel A&B | U-AN-TOOLRESP-01 / A-AN-04,U-AN-TOOLRESP-02 / U-AN-TOOLRESP-04 |
| AN stream text SSE / tool accumulate / multi-index / empty[] / frag | U-AN-STREAM-01 / U-AN-STREAM-TOOLS-01 / -02 / -03 / A-STREAM-05 |
| AN tool_result content part | U-AN-TOOLRESP-03 |
| Loop chat: native / precedence / empty-suppress / text / finish | U-LOOP-NATIVE-01 / -02 / -03 / U-LOOP-TEXT-01 / U-LOOP-FINISH-01 |
| Loop stream: native terminal / empty-suppress / no-double-dispatch / text fallback | U-LOOP-STREAM-NATIVE-01 / -02 / -03 / U-LOOP-STREAM-TEXT-01 |
| Full integration both providers, both paths | I-OA-STREAM-*, I-OA-CHAT-TOOLS-01, I-AN-STREAM-*, I-AN-CHAT-TOOLS-01 |
| Full e2e wire-hash + vision | E2E-LOOP-01 / -02 |

## Locked implementation notes
1. **Terminal stream native-call surface (locked).** `LLMStreamChunk` (both packages) gains `finishReason?: string | undefined` and **terminal-only** `toolCalls?: {id:string;name:string;args:Record<string,unknown>}[] | undefined`. Non-terminal chunks MUST omit `toolCalls`. `executeModelAndTools` consumes terminal `toolCalls` first; `toolCalls === undefined` ⇒ fall back to `parseToolRequests(content)`; defined `[]` ⇒ suppress text parse (D1). Mid-stream concurrent-safe text dispatch is skipped on any turn where native tool calls are being accumulated (no double-dispatch — see U-LOOP-STREAM-NATIVE-03).
2. **Agent-local type mirror (locked).** `packages/agent/src/llm.ts` mirrors the ai-facing subset of `packages/ai/src/types.ts`:
   - `LLMContentPart = {type:"text";text} | {type:"image";mediaType;data} | {type:"tool_result";toolUseId;content}`
   - `LLMMessage = {role:"system"|"user"|"assistant"|"tool"; content:string|LLMContentPart[]; toolCallId?}`  *(intentionally WIDER than ai's `role` union: providers accept `tool`-role inputs even though the v1 loop doesn't emit them)*
   - `LLMToolSpec = {name;description;parameters?}`; `LLMResponse` adds `toolCalls?`; `LLMStreamChunk` adds `finishReason?`+terminal `toolCalls?`; `LLMOptions` adds `signal?`+`tools?`.
   - **Assignability is one-directional** (corrects GPT round-3 "bidirectional"): the returned provider object MUST be assignable to `ai.LLMProvider` (so the loop consumes it), which requires `ai.LLMMessage` assignable to `agent.LLMMessage` (inputs, contravariant — holds since ai's role union is narrower) and `agent.LLMResponse`/`agent.LLMStreamChunk` assignable to `ai`'s (outputs). Bidirectional equality is NOT required and would fail by design.
3. **A-OA-01 bad-args → `{}`** (locked).
4. **Build-before-final-battery + relative-src test imports for mutation** (locked).
