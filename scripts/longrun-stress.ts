/**
 * Deterministic long-horizon / long-context stress harness for createSmartAgent.
 *
 * Uses a SCRIPTED (no-network) LLM so we can exercise the loop machinery
 * reproducibly and MEASURE it via the event stream:
 *   - long-horizon: sustain N sequential tool-calling iterations to completion
 *   - long-context: blow past the context window and verify the compaction
 *     cascade (snip -> microcompact -> autocompact) keeps tokens BOUNDED and
 *     the run still completes correctly
 *   - reactive recovery: provider throws "prompt too long"; verify the loop
 *     recovers (reactive compact) and finishes
 *
 * Run: bun run scripts/longrun-stress.ts
 */
import { createSmartAgent } from "../packages/ai/src/index.js";
import type {
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  AgentEvent,
} from "../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Scripted "model": follows a record chain by reading the LATEST tool result.
// ---------------------------------------------------------------------------

function messageStr(c: LLMMessage["content"]): string {
  return typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "[img]")).join("");
}

/** Find the most recent `lookup` tool result and parse its JSON payload. */
function latestLookup(messages: LLMMessage[]): { value: number; runningSum: number; nextId: number | null } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = messageStr(m.content);
    if (!t.includes('Tool "lookup" returned')) continue;
    if (t.includes("(truncated")) continue; // skip compacted/older results
    // Brace-match the FIRST balanced JSON object (string-aware) so trailing
    // text (e.g. a continuation prompt merged into this user message by
    // normalizeMessages) doesn't break parsing — a real model wouldn't choke.
    const start = t.indexOf("{");
    if (start < 0) continue;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = start; k < t.length; k++) {
      const c = t[k];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) continue;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return null;
}

interface ScriptedOpts {
  /** throw "prompt too long" when serialized input exceeds this many chars */
  hardLimitChars?: number;
}

function scriptedChainLLM(opts: ScriptedOpts = {}): LLMProvider & { calls: number; autocompactCalls: number; throws: number } {
  const self = {
    name: "scripted-chain",
    calls: 0,
    autocompactCalls: 0,
    throws: 0,
    async chat(messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      self.calls++;
      // Autocompact summarizer call: [system(AUTOCOMPACT_PROMPT), user(conversation)]
      const first = messages[0];
      if (first && first.role === "system" && messageStr(first.content).includes("You are summarizing a conversation")) {
        self.autocompactCalls++;
        return {
          content: JSON.stringify({ summary: "Following a record chain; continue from the latest lookup result.", memories: [] }),
          model: "scripted",
        };
      }
      // Simulate a real provider rejecting an over-long prompt -> drives reactive recovery.
      if (opts.hardLimitChars) {
        const size = messages.reduce((n, m) => n + messageStr(m.content).length, 0);
        if (size > opts.hardLimitChars) {
          self.throws++;
          if (process.env.TRACE) console.error(`  [call ${self.calls}] msgs=${messages.length} size=${size} -> THROW (prompt too long)`);
          throw new Error("prompt too long: input exceeds the model context window");
        }
      }
      const latest = latestLookup(messages);
      const trace = (issued: string) => {
        if (process.env.TRACE) console.error(`  [call ${self.calls}] msgs=${messages.length} latestId=${latest?.id ?? "none"} nextId=${latest?.nextId ?? "?"} -> ${issued}`);
        if (process.env.TRACE === "2") {
          for (const m of messages) {
            const t = messageStr(m.content).replace(/\s+/g, " ");
            console.error(`        [${m.role}] ${t.slice(0, 70)}`);
          }
        }
      };
      if (!latest) {
        trace("lookup(1)");
        return { content: JSON.stringify({ tool: "lookup", arguments: { id: 1 } }), model: "scripted" };
      }
      if (latest.nextId === null) {
        trace("FINAL");
        return { content: `Done. The final running sum of all collected values is ${latest.runningSum}.`, model: "scripted" };
      }
      trace(`lookup(${latest.nextId})`);
      return { content: JSON.stringify({ tool: "lookup", arguments: { id: latest.nextId } }), model: "scripted" };
    },
  };
  return self;
}

// ---------------------------------------------------------------------------
// Chain tool: each record points to the next; server tracks the running sum.
// `padChars` inflates each result to apply context pressure.
// ---------------------------------------------------------------------------

function chainTool(records: number, padChars: number): { tool: AgentTool; expectedSum: number; executedIds: number[] } {
  let runningSum = 0;
  let expectedSum = 0;
  for (let i = 1; i <= records; i++) expectedSum += i * 7;
  const pad = "x".repeat(padChars);
  const executedIds: number[] = [];
  const tool: AgentTool = {
    name: "lookup",
    description: "Look up record by id; returns value, runningSum, and nextId.",
    parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    async execute(args) {
      const id = Number((args as { id: number }).id);
      if (!Number.isFinite(id) || id < 1 || id > records) return { error: `no record ${id}` };
      runningSum += id * 7;
      executedIds.push(id);
      return {
        id,
        value: id * 7,
        runningSum,
        nextId: id < records ? id + 1 : null,
        padding: pad, // context-pressure ballast
      };
    },
  };
  return { tool, expectedSum, executedIds };
}

interface Metrics {
  iterations: number;
  toolCalls: number;
  compression: Record<string, number>;
  errorRecovery: Record<string, number>;
  peakTokens: number;
  tokenSeries: number[];
}

async function runScenario(
  label: string,
  cfg: { records: number; padChars: number; contextWindowSize: number; maxIterations: number; hardLimitChars?: number },
): Promise<{ ok: boolean; status: string; result: string; expectedSum: number; metrics: Metrics; llm: { calls: number; autocompactCalls: number; throws: number } }> {
  const { tool, expectedSum, executedIds } = chainTool(cfg.records, cfg.padChars);
  const llm = scriptedChainLLM({ ...(cfg.hardLimitChars ? { hardLimitChars: cfg.hardLimitChars } : {}) });
  const agent = createSmartAgent({
    llm,
    tools: [tool],
    maxIterations: cfg.maxIterations,
    contextWindowSize: cfg.contextWindowSize,
  });

  const m: Metrics = { iterations: 0, toolCalls: 0, compression: {}, errorRecovery: {}, peakTokens: 0, tokenSeries: [] };
  let finalResult = "";
  let status = "unknown";

  const goal =
    `Follow the record chain from id 1. Call lookup one at a time, using nextId from each result, ` +
    `until nextId is null. Then report the final running sum. The chain has ${cfg.records} records.`;

  const stream = agent.stream(goal);
  let next = await stream.next();
  while (!next.done) {
    const ev = next.value as AgentEvent;
    if (ev.type === "iteration_start") {
      m.iterations = (ev as { iteration: number }).iteration;
      const tok = (ev as { estimatedTokens?: number }).estimatedTokens ?? 0;
      m.tokenSeries.push(tok);
      if (tok > m.peakTokens) m.peakTokens = tok;
    } else if (ev.type === "compression") {
      const s = (ev as { strategy: string }).strategy;
      m.compression[s] = (m.compression[s] ?? 0) + 1;
    } else if (ev.type === "error_recovery") {
      const s = (ev as { strategy: string }).strategy;
      m.errorRecovery[s] = (m.errorRecovery[s] ?? 0) + 1;
    } else if (ev.type === "tool_call_end") {
      m.toolCalls++;
    }
    next = await stream.next();
  }
  const runResult = next.value;
  status = runResult.status;
  finalResult = String(runResult.result ?? "");
  const ok = status === "completed" && finalResult.includes(String(expectedSum));

  console.log(`\n=== ${label} ===`);
  console.log(`  config: records=${cfg.records} padChars=${cfg.padChars} window=${cfg.contextWindowSize} maxIter=${cfg.maxIterations}${cfg.hardLimitChars ? ` hardLimit=${cfg.hardLimitChars}` : ""}`);
  console.log(`  status=${status}  iterations=${runResult.iterations}  toolCalls=${runResult.toolCalls.length}`);
  console.log(`  llm.calls=${llm.calls}  autocompactCalls=${llm.autocompactCalls}  providerThrows=${llm.throws}`);
  console.log(`  compression events: ${JSON.stringify(m.compression)}`);
  if (Object.keys(m.errorRecovery).length) console.log(`  error_recovery events: ${JSON.stringify(m.errorRecovery)}`);
  console.log(`  peak estimatedTokens=${m.peakTokens} (window=${cfg.contextWindowSize}, ${((m.peakTokens / cfg.contextWindowSize) * 100).toFixed(0)}% of window)`);
  console.log(`  expectedSum=${expectedSum}  finalResult="${finalResult.slice(0, 80)}"`);
  const seen = new Set<number>();
  const dups = executedIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  console.log(`  distinct ids=${seen.size}/${cfg.records}  total executions=${executedIds.length}  duplicates=[${[...new Set(dups)].join(",")}]`);
  if (dups.length) console.log(`  exec order: ${executedIds.join(",")}`);
  console.log(`  VERDICT: ${ok ? "PASS ✓" : "FAIL ✗"}`);
  return { ok, status, result: finalResult, expectedSum, metrics: m, llm: { calls: llm.calls, autocompactCalls: llm.autocompactCalls, throws: llm.throws } };
}

async function main() {
  const results: { ok: boolean }[] = [];

  // A. LONG-HORIZON: 120 sequential steps, tiny results, big window (no compaction).
  results.push(await runScenario("A. Long-horizon (120 sequential tool calls, no context pressure)", {
    records: 120, padChars: 0, contextWindowSize: 200_000, maxIterations: 200,
  }));

  // B. LONG-CONTEXT: 40 steps, fat results, tiny window -> proactive compaction cascade.
  results.push(await runScenario("B. Long-context (fat results, tiny 4k window -> proactive compaction)", {
    records: 40, padChars: 3000, contextWindowSize: 4000, maxIterations: 80,
  }));

  // C. REACTIVE RECOVERY: large window (proactive compaction stays quiet) but the
  // provider hard-rejects prompts over a LOW char limit -> forces the error-driven
  // recovery path (autocompact / reactive compact) to kick in and finish the run.
  results.push(await runScenario("C. Reactive recovery (provider throws 'prompt too long' below configured window)", {
    records: 30, padChars: 2500, contextWindowSize: 400_000, maxIterations: 80, hardLimitChars: 18_000,
  }));

  const allOk = results.every((r) => r.ok);
  console.log(`\n================  OVERALL: ${allOk ? "ALL PASS ✓" : "SOME FAILED ✗"}  ================`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(2);
});
