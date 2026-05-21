/**
 * REAL-LLM long-context test: drives createSmartAgent with gpt-5.5 (via the
 * cocode Responses API) on a record-chain task with a deliberately TINY
 * contextWindowSize, forcing the proactive compaction cascade
 * (snip -> microcompact -> autocompact) to run against a real model. Verifies
 * the agent still follows the chain and reports the correct sum, and prints the
 * actual autocompact summaries gpt-5.5 generated (the thing the deterministic
 * harness can't test).
 *
 * Config from .env.test (gitignored). Run: bun run scripts/longrun-real.ts
 */
import { readFileSync } from "node:fs";
import { createSmartAgent } from "../packages/ai/src/index.js";
import type { AgentTool, AgentEvent, LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "../packages/ai/src/types.js";

// --- .env.test loader ---
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env.test", import.meta.url), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
const env = loadEnv();

function msgText(c: LLMMessage["content"]): string {
  return typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join("");
}

// --- cocode Responses-API adapter -> Capstan LLMProvider (text path) ---
let autocompactSummaries = 0;
function cocodeProvider(cfg: { apiKey: string; baseUrl: string; model: string; effort: string }): LLMProvider {
  return {
    name: `cocode:${cfg.model}`,
    async chat(messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      const sys = messages.filter((m) => m.role === "system").map((m) => msgText(m.content)).join("\n\n");
      const isAutocompact = sys.includes("You are summarizing a conversation");
      const input = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role,
          content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: msgText(m.content) }],
        }));
      const body = {
        model: cfg.model,
        input: input.length ? input : [{ role: "user", content: [{ type: "input_text", text: "(begin)" }] }],
        instructions: sys || "You are a helpful autonomous agent.",
        reasoning: { effort: cfg.effort },
        store: false,
        stream: false,
      };
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/v1/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`cocode ${res.status}: ${raw.slice(0, 300)}`);
      let content = "";
      if (raw.startsWith("event:")) {
        // SSE: prefer response.completed; fall back to accumulated deltas.
        const completed = raw.split("\n").reduce<{ want: boolean; line: string }>((acc, l) => {
          if (l.startsWith("event: response.completed")) return { want: true, line: "" };
          if (acc.want && l.startsWith("data: ")) return { want: false, line: l.slice(6) };
          return acc;
        }, { want: false, line: "" }).line;
        try {
          const d = JSON.parse(completed);
          content = (d.response?.output ?? []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
        } catch { /* ignore */ }
        if (!content) {
          content = raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)).delta ?? ""; } catch { return ""; } }).join("");
        }
      } else {
        const d = JSON.parse(raw);
        content = d.output_text ?? (d.output ?? []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
      }
      if (isAutocompact) {
        autocompactSummaries++;
        console.log(`\n  [autocompact #${autocompactSummaries}] gpt-5.5 summary:\n    ${content.replace(/\n/g, "\n    ").slice(0, 600)}\n`);
      }
      return { content, model: cfg.model };
    },
  };
}

// --- record-chain tool (each result carries nextId + runningSum) ---
function chainTool(records: number, padChars: number) {
  let runningSum = 0;
  let expectedSum = 0;
  for (let i = 1; i <= records; i++) expectedSum += i * 7;
  const executedIds: number[] = [];
  const pad = "x".repeat(padChars);
  const tool: AgentTool = {
    name: "lookup",
    description: "Look up a record by id. Returns its value, the running sum so far, and nextId (the id to look up next, or null when done).",
    parameters: { type: "object", properties: { id: { type: "number", description: "record id" } }, required: ["id"] },
    async execute(args) {
      const id = Number((args as { id: number }).id);
      if (!Number.isFinite(id) || id < 1 || id > records) return { error: `no record ${id}` };
      runningSum += id * 7;
      executedIds.push(id);
      return { id, value: id * 7, runningSum, nextId: id < records ? id + 1 : null, padding: pad };
    },
  };
  return { tool, expectedSum, executedIds };
}

async function main() {
  const RECORDS = 18;
  const provider = cocodeProvider({ apiKey: env.LLM_API_KEY!, baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!, effort: env.LLM_REASONING_EFFORT || "low" });
  const { tool, expectedSum, executedIds } = chainTool(RECORDS, 400);

  const agent = createSmartAgent({
    llm: provider,
    tools: [tool],
    maxIterations: 60,
    contextWindowSize: 1500, // TINY -> forces proactive compaction with a real model
  });

  const goal =
    `Follow a chain of records. Call the "lookup" tool starting at id 1. Each result gives nextId — ` +
    `call lookup again with that id, one at a time, until nextId is null. Then state the final running sum. ` +
    `The chain has ${RECORDS} records.`;

  const compression: Record<string, number> = {};
  let peakTokens = 0;
  const t0 = Date.now();
  console.log(`Running gpt-5.5 over a ${RECORDS}-record chain, contextWindowSize=1500 (forces compaction)...`);

  const stream = agent.stream(goal);
  let n = await stream.next();
  while (!n.done) {
    const ev = n.value as AgentEvent;
    if (ev.type === "iteration_start") {
      const tok = (ev as { estimatedTokens?: number }).estimatedTokens ?? 0;
      if (tok > peakTokens) peakTokens = tok;
      process.stdout.write(`  iter ${(ev as { iteration: number }).iteration} (~${tok} tok)\r`);
    } else if (ev.type === "compression") {
      const s = (ev as { strategy: string }).strategy;
      compression[s] = (compression[s] ?? 0) + 1;
    }
    n = await stream.next();
  }
  const result = n.value;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const seen = new Set<number>();
  const dups = executedIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  const ok = result.status === "completed" && String(result.result ?? "").includes(String(expectedSum));

  console.log(`\n\n================ REAL gpt-5.5 long-context run ================`);
  console.log(`  status=${result.status}  iterations=${result.iterations}  toolCalls=${result.toolCalls.length}  (${secs}s)`);
  console.log(`  compression events: ${JSON.stringify(compression)}  (autocompact summaries seen: ${autocompactSummaries})`);
  console.log(`  peak estimatedTokens=${peakTokens} (window=1500)`);
  console.log(`  distinct records=${seen.size}/${RECORDS}  executions=${executedIds.length}  duplicates=[${[...new Set(dups)].join(",")}]`);
  console.log(`  expectedSum=${expectedSum}`);
  console.log(`  final answer: "${String(result.result ?? "").slice(0, 200)}"`);
  console.log(`  VERDICT: ${ok ? "PASS ✓ (real model completed the long-horizon task across live compaction)" : "FAIL ✗"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("\nharness error:", e); process.exit(2); });
