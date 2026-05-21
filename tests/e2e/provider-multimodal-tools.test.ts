import { describe, it, expect, afterEach } from "bun:test";
import { createHash } from "node:crypto";
// Real provider + real loop (relative src imports).
import { openaiProvider } from "../../packages/agent/src/llm.ts";
import { runSmartLoop } from "../../packages/ai/src/loop/engine.ts";
import type { AgentTool, SmartAgentConfig } from "../../packages/ai/src/types.ts";

// ---------------------------------------------------------------------------
// E2E-LOOP-01 (D4) — full runSmartLoop <-> local Bun.serve mock.
// Turn 1: streamed native tool-call deltas for a screenshot tool.
// Turn 2: the mock base64-decodes the inbound image_url data URL, asserts the
//   PNG signature and sha256 == artifact sha256, then returns final text.
// Oracle: status completed, final text matches, server logged the hash match.
//
// E2E-LOOP-02 (Gemini-vision) is intentionally NOT here — the orchestrator runs
// the vision oracle manually via ask-gemini.sh on the real artifact.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A real, valid 1x1 PNG generated in-test, used as the "screenshot". */
const SCREENSHOT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const ARTIFACT_SHA256 = createHash("sha256")
  .update(Buffer.from(SCREENSHOT_PNG_BASE64, "base64"))
  .digest("hex");

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const payload = lines.join("\n") + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("E2E-LOOP-01 — full loop <-> Bun.serve mock (wire hash-equality)", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  it("E2E-LOOP-01 — screenshot bytes round-trip; mock verifies PNG signature + sha256", async () => {
    let callCount = 0;
    const serverLog = {
      hashMatch: false as boolean,
      signatureOk: false as boolean,
      receivedSha: "" as string,
    };

    server = Bun.serve({
      port: 0, // ephemeral port
      async fetch(req) {
        const url = new URL(req.url);
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 });
        }
        const body = (await req.json()) as any;
        callCount++;

        if (callCount === 1) {
          // Turn 1 — emit a native tool-call for `screenshot`.
          return sseResponse([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_shot","function":{"name":"screenshot","arguments":"{}"}}]}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            "data: [DONE]",
          ]);
        }

        // Turn 2 — find the inbound image_url, decode, verify.
        let dataUrl: string | undefined;
        for (const m of body.messages ?? []) {
          if (Array.isArray(m.content)) {
            for (const part of m.content) {
              if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
                dataUrl = part.image_url.url;
              }
            }
          }
        }
        if (dataUrl) {
          const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
          const decoded = Buffer.from(base64, "base64");
          serverLog.signatureOk = PNG_SIGNATURE.every((b, i) => decoded[i] === b);
          serverLog.receivedSha = createHash("sha256").update(decoded).digest("hex");
          serverLog.hashMatch = serverLog.receivedSha === ARTIFACT_SHA256;
        }

        return sseResponse([
          'data: {"choices":[{"delta":{"content":"I can see the page"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ]);
      },
    });

    const port = server.port;
    const screenshotTool: AgentTool = {
      name: "screenshot",
      description: "capture a screenshot of the page",
      isConcurrencySafe: true,
      async execute() {
        return { image: { mediaType: "image/png", base64: SCREENSHOT_PNG_BASE64 } };
      },
    };

    const config: SmartAgentConfig = {
      llm: openaiProvider({ apiKey: "sk-e2e", baseUrl: `http://127.0.0.1:${port}/v1` }),
      tools: [screenshotTool],
      maxIterations: 5,
    };

    const result = await runSmartLoop(config, "screenshot the page and tell me what you see");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("I can see the page");
    // Server-side deterministic wire proof:
    expect(serverLog.signatureOk).toBe(true);
    expect(serverLog.hashMatch).toBe(true);
    expect(serverLog.receivedSha).toBe(ARTIFACT_SHA256);
  });
});
