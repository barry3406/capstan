// S-TYPE-01 — compile-only type-compat guard (no drift between the agent
// type mirror and the ai-facing types). This file is checked by `tsc --noEmit`,
// NOT run as a bun test. Oracle: tsc exit 0.
//
// Assignability is ONE-DIRECTIONAL (locked notes #2): the provider object
// returned by the bundled providers MUST satisfy `ai.LLMProvider` (so the loop
// can consume it). `agent.LLMMessage` is intentionally WIDER (adds the `tool`
// role + `tool_result` part the v1 loop never emits), so bidirectional equality
// is NOT required and would fail by design.

import { openaiProvider, anthropicProvider } from "../../packages/agent/src/llm.ts";
import type * as agent from "../../packages/agent/src/llm.ts";
import type * as ai from "../../packages/ai/src/types.ts";

// 1. The returned provider objects must be assignable to ai.LLMProvider.
const _pOpenAI: ai.LLMProvider = openaiProvider({ apiKey: "" });
const _pAnthropic: ai.LLMProvider = anthropicProvider({ apiKey: "" });

// 2. Inputs (contravariant): ai.LLMMessage must flow into agent.LLMMessage.
//    (Holds because ai's role union is narrower than agent's.)
declare const aiMsg: ai.LLMMessage;
const _agentMsg: agent.LLMMessage = aiMsg;

// 3. Outputs: agent provider outputs must be assignable to the ai-facing shapes.
declare const agentResponse: agent.LLMResponse;
const _aiResponse: ai.LLMResponse = agentResponse;

declare const agentChunk: agent.LLMStreamChunk;
const _aiChunk: ai.LLMStreamChunk = agentChunk;

// Reference the bindings so noUnusedLocals (if enabled) stays quiet.
export const _typeCompatRefs = {
  _pOpenAI,
  _pAnthropic,
  _agentMsg,
  _aiResponse,
  _aiChunk,
} as const;
