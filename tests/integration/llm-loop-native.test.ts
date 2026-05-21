import { describe, it, expect, afterEach } from "bun:test";
// Real providers via relative src path; real loop from engine.
import { openaiProvider, anthropicProvider } from "../../packages/agent/src/llm.ts";
import { runSmartLoop } from "../../packages/ai/src/loop/engine.ts";
import type { AgentTool, LLMProvider, SmartAgentConfig } from "../../packages/ai/src/types.ts";

// ---------------------------------------------------------------------------
// fetch capture/restore + scripted multi-call helper
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

interface ScriptedCall {
  /** Inspect the parsed request body. */
  body?: Record<string, unknown>;
}

/** Install a scripted fetch: each call N consumes responders[N]. The captured
 * parsed body for each call is recorded into `calls`. */
function scriptFetch(
  responders: Array<(body: any) => Response>,
  calls: ScriptedCall[],
): void {
  let i = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calls.push({ body });
    const responder = responders[i] ?? responders[responders.length - 1]!;
    i++;
    return responder(body);
  }) as unknown as typeof fetch;
}

function baseConfig(llm: LLMProvider, tools: AgentTool[]): SmartAgentConfig {
  return { llm, tools, maxIterations: 5 };
}

const echoTool: AgentTool = {
  name: "echo",
  description: "echo back",
  isConcurrencySafe: true,
  parameters: { type: "object", properties: { msg: { type: "string" } } },
  async execute(args) {
    return { echoed: args };
  },
};

// ===========================================================================
// §2 Integration — OpenAI
// ===========================================================================

describe("§2 integration — OpenAI", () => {
  it("I-OA-STREAM-TOOLS-01 — streaming native tool call -> completion", async () => {
    const calls: ScriptedCall[] = [];
    scriptFetch(
      [
        // call 1 — streamed tool-call deltas for echo
        () =>
          new Response(
            sseBody([
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"msg\\":\\"hi\\"}"}}]}}]}',
              'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
              "data: [DONE]",
            ]),
            { status: 200 },
          ),
        // call 2 — streamed final text
        () =>
          new Response(
            sseBody([
              'data: {"choices":[{"delta":{"content":"done"}}]}',
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
              "data: [DONE]",
            ]),
            { status: 200 },
          ),
      ],
      calls,
    );

    const result = await runSmartLoop(baseConfig(openaiProvider({ apiKey: "sk" }), [echoTool]), "go");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("done");
    const echoRecord = result.toolCalls.find((r) => r.tool === "echo");
    expect(echoRecord).toBeDefined();
    expect(echoRecord!.status).toBe("success");
    // call-1 body advertised tools
    expect(Array.isArray((calls[0]!.body as any).tools)).toBe(true);
  });

  it("I-OA-CHAT-TOOLS-01 — chat() native path (stream:undefined) with tool_calls JSON", async () => {
    const calls: ScriptedCall[] = [];
    scriptFetch(
      [
        () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      { id: "call_1", type: "function", function: { name: "echo", arguments: '{"msg":"hi"}' } },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              model: "gpt-4o",
            }),
            { status: 200 },
          ),
        () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "done" }, finish_reason: "stop" }],
              model: "gpt-4o",
            }),
            { status: 200 },
          ),
      ],
      calls,
    );

    const provider = openaiProvider({ apiKey: "sk" });
    const result = await runSmartLoop(
      baseConfig({ ...provider, stream: undefined }, [echoTool]),
      "go",
    );

    expect(result.status).toBe("completed");
    expect(result.result).toBe("done");
    expect(result.toolCalls.find((r) => r.tool === "echo")?.status).toBe("success");
    expect(Array.isArray((calls[0]!.body as any).tools)).toBe(true);
  });

  it("I-OA-STREAM-IMG-01 — tool returns image; call-2 body carries image_url data URL", async () => {
    const shootTool: AgentTool = {
      name: "shoot",
      description: "take a screenshot",
      isConcurrencySafe: true,
      async execute() {
        return { image: { mediaType: "image/png", base64: "AAAB" } };
      },
    };

    const calls: ScriptedCall[] = [];
    scriptFetch(
      [
        // call 1 — tool-call for shoot
        () =>
          new Response(
            sseBody([
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shoot","arguments":"{}"}}]}}]}',
              'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
              "data: [DONE]",
            ]),
            { status: 200 },
          ),
        // call 2 — capture body, return final text
        () =>
          new Response(
            sseBody([
              'data: {"choices":[{"delta":{"content":"saw it"}}]}',
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
              "data: [DONE]",
            ]),
            { status: 200 },
          ),
      ],
      calls,
    );

    const result = await runSmartLoop(baseConfig(openaiProvider({ apiKey: "sk" }), [shootTool]), "go");

    expect(result.status).toBe("completed");
    // call-2 request body must include the image as an image_url data URL part
    const bodyStr = JSON.stringify(calls[1]!.body);
    expect(bodyStr).toContain('"image_url"');
    expect(bodyStr).toContain("data:image/png;base64,AAAB");
  });
});

// ===========================================================================
// §2 Integration — Anthropic
// ===========================================================================

describe("§2 integration — Anthropic", () => {
  it("I-AN-STREAM-TOOLS-01 — streaming tool_use round-trip to completion; call-1 had input_schema", async () => {
    const calls: ScriptedCall[] = [];
    scriptFetch(
      [
        // call 1 — streamed tool_use
        () =>
          new Response(
            sseBody([
              'event: content_block_start',
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"echo"}}',
              '',
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"msg\\":\\"hi\\"}"}}',
              '',
              'event: message_delta',
              'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
              '',
              'event: message_stop',
              'data: {"type":"message_stop"}',
              '',
            ]),
            { status: 200 },
          ),
        // call 2 — streamed final text
        () =>
          new Response(
            sseBody([
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}',
              '',
              'event: message_delta',
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
              '',
              'event: message_stop',
              'data: {"type":"message_stop"}',
              '',
            ]),
            { status: 200 },
          ),
      ],
      calls,
    );

    const result = await runSmartLoop(baseConfig(anthropicProvider({ apiKey: "sk" }), [echoTool]), "go");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("done");
    expect(result.toolCalls.find((r) => r.tool === "echo")?.status).toBe("success");
    const tools = (calls[0]!.body as any).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0]).toHaveProperty("input_schema");
  });

  it("I-AN-STREAM-IMG-01 — call-2 body carries image source.base64", async () => {
    const shootTool: AgentTool = {
      name: "shoot",
      description: "take a screenshot",
      isConcurrencySafe: true,
      async execute() {
        return { image: { mediaType: "image/png", base64: "AAAB" } };
      },
    };

    const calls: ScriptedCall[] = [];
    scriptFetch(
      [
        () =>
          new Response(
            sseBody([
              'event: content_block_start',
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"shoot"}}',
              '',
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
              '',
              'event: message_delta',
              'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
              '',
              'event: message_stop',
              'data: {"type":"message_stop"}',
              '',
            ]),
            { status: 200 },
          ),
        () =>
          new Response(
            sseBody([
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"saw it"}}',
              '',
              'event: message_delta',
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
              '',
              'event: message_stop',
              'data: {"type":"message_stop"}',
              '',
            ]),
            { status: 200 },
          ),
      ],
      calls,
    );

    const result = await runSmartLoop(baseConfig(anthropicProvider({ apiKey: "sk" }), [shootTool]), "go");

    expect(result.status).toBe("completed");
    const bodyStr = JSON.stringify(calls[1]!.body);
    expect(bodyStr).toContain('"source"');
    expect(bodyStr).toContain('"media_type":"image/png"');
    expect(bodyStr).toContain('"data":"AAAB"');
  });

  it("I-AN-CHAT-TOOLS-01 — chat() native path (stream:undefined) with tool_use bodies", async () => {
    const calls: ScriptedCall[] = [];
    scriptFetch(
      [
        () =>
          new Response(
            JSON.stringify({
              content: [{ type: "tool_use", id: "tu_1", name: "echo", input: { msg: "hi" } }],
              model: "claude",
              stop_reason: "tool_use",
            }),
            { status: 200 },
          ),
        () =>
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "done" }],
              model: "claude",
              stop_reason: "end_turn",
            }),
            { status: 200 },
          ),
      ],
      calls,
    );

    const provider = anthropicProvider({ apiKey: "sk" });
    const result = await runSmartLoop(
      baseConfig({ ...provider, stream: undefined }, [echoTool]),
      "go",
    );

    expect(result.status).toBe("completed");
    expect(result.result).toBe("done");
    expect(result.toolCalls.find((r) => r.tool === "echo")?.status).toBe("success");
    const tools = (calls[0]!.body as any).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0]).toHaveProperty("input_schema");
  });
});
