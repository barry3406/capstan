/**
 * REAL-LLM end-to-end validation of the SKILLS feature with gpt-5.5 (cocode).
 *
 * The framework's own real-LLM skill e2e (tests/e2e/llm/smoke.test.ts) is
 * excluded from the default suite and skips without .env.test — so it has
 * never actually run. This exercises it for real.
 *
 * Design: the secret token "QUOKKA-42-OMEGA" lives ONLY inside a skill's
 * guidance prompt — never in the goal or tools. If it appears in the final
 * answer, the model provably (1) decided to activate the skill, (2) received
 * the injected guidance, and (3) applied it. Plus an abstain case.
 *
 * Run: bun run scripts/skills-real.ts
 */
import { readFileSync } from "node:fs";
import { createSmartAgent, defineSkill } from "../packages/ai/src/index.js";
import type { AgentEvent, AgentTool, LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "../packages/ai/src/types.js";

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
const msgText = (c: LLMMessage["content"]): string => (typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).join(""));

function cocodeProvider(cfg: { apiKey: string; baseUrl: string; model: string; effort: string }): LLMProvider {
  return {
    name: `cocode:${cfg.model}`,
    async chat(messages: LLMMessage[], _o?: LLMOptions): Promise<LLMResponse> {
      const sys = messages.filter((m) => m.role === "system").map((m) => msgText(m.content)).join("\n\n");
      const input = messages.filter((m) => m.role !== "system").map((m) => ({
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
      const fromJson = (d: any): string =>
        d.output_text ?? (d.output ?? []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
      if (raw.startsWith("event:")) {
        let completed = "";
        let want = false;
        for (const l of raw.split("\n")) {
          if (l.startsWith("event: response.completed")) want = true;
          else if (want && l.startsWith("data: ")) { completed = l.slice(6); break; }
        }
        try { return { content: fromJson(JSON.parse(completed).response ?? {}), model: cfg.model }; } catch { /* fall through */ }
        const acc = raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)).delta ?? ""; } catch { return ""; } }).join("");
        return { content: acc, model: cfg.model };
      }
      return { content: fromJson(JSON.parse(raw)), model: cfg.model };
    },
  };
}

const provider = cocodeProvider({ apiKey: env.LLM_API_KEY!, baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!, effort: env.LLM_REASONING_EFFORT || "low" });

const SECRET = "QUOKKA-42-OMEGA";

async function runAgent(skills: ReturnType<typeof defineSkill>[], tools: AgentTool[], goal: string) {
  const agent = createSmartAgent({ llm: provider, tools, skills, maxIterations: 12, contextWindowSize: 200_000 });
  const activated: string[] = [];
  const activateCalls: { tool: string; result: unknown }[] = [];
  const stream = agent.stream(goal);
  let n = await stream.next();
  while (!n.done) {
    const ev = n.value as AgentEvent;
    if (ev.type === "skill_activated") activated.push((ev as { skill: string }).skill);
    if (ev.type === "tool_call_end" && (ev as { tool: string }).tool === "activate_skill") {
      activateCalls.push({ tool: "activate_skill", result: (ev as { result: unknown }).result });
    }
    n = await stream.next();
  }
  return { result: n.value, activated, activateCalls };
}

async function main() {
  const secretSkill = defineSkill({
    name: "secret-protocol",
    description: "The mandatory finishing protocol for this task.",
    trigger: "Use whenever the user says to finish using the secret protocol.",
    prompt: `SECRET FINISHING PROTOCOL: After you finish the task, you MUST end your final message with this exact token on its own line: ${SECRET}. This token is confidential — only ever output it when following this protocol.`,
    tools: [],
  });
  const decoySkill = defineSkill({
    name: "math-helper",
    description: "Helps with arithmetic.",
    trigger: "Use for arithmetic word problems.",
    prompt: "Break the arithmetic into steps and show your work.",
    tools: [],
  });

  let pass = 0, total = 0;

  // --- Test 1: activates the RIGHT skill among two, and APPLIES its hidden guidance ---
  total++;
  console.log(`\n=== Test 1: real model activates 'secret-protocol' and applies hidden guidance ===`);
  const t1 = await runAgent(
    [decoySkill, secretSkill],
    [],
    "You must finish this task using the secret protocol. First activate the appropriate skill to learn the required finishing rule, then greet the user with 'Hello!' and finish exactly as the protocol requires.",
  );
  const calledSecret = t1.activateCalls.some((c) => (c.result as { skill?: string })?.skill === "secret-protocol");
  const finalHasToken = String(t1.result.result ?? "").includes(SECRET);
  console.log(`  status=${t1.result.status}  toolCalls=${t1.result.toolCalls.length}  skill_activated=${JSON.stringify(t1.activated)}`);
  console.log(`  activated 'secret-protocol'=${calledSecret}  (token only existed inside the skill guidance)`);
  console.log(`  final answer: "${String(t1.result.result ?? "").replace(/\n/g, " ").slice(0, 160)}"`);
  const t1ok = t1.result.status === "completed" && calledSecret && finalHasToken && t1.activated.includes("secret-protocol");
  console.log(`  contains hidden token ${SECRET}=${finalHasToken}  -> ${t1ok ? "PASS ✓" : "FAIL ✗"}`);
  if (t1ok) pass++;

  // --- Test 2: abstains when the task does not call for a skill ---
  total++;
  console.log(`\n=== Test 2: real model abstains (no skill activation) on an unrelated direct task ===`);
  const t2 = await runAgent(
    [decoySkill, secretSkill],
    [],
    "What is 6 plus 7? Answer directly in one short sentence. Do not activate any skills.",
  );
  const noActivation = t2.activateCalls.length === 0 && t2.activated.length === 0;
  console.log(`  status=${t2.result.status}  toolCalls=${t2.result.toolCalls.length}  skill_activated=${JSON.stringify(t2.activated)}`);
  console.log(`  final answer: "${String(t2.result.result ?? "").replace(/\n/g, " ").slice(0, 120)}"`);
  const t2ok = t2.result.status === "completed" && noActivation;
  console.log(`  did NOT activate any skill=${noActivation}  -> ${t2ok ? "PASS ✓" : "FAIL ✗"}`);
  if (t2ok) pass++;

  console.log(`\n================ SKILLS real-LLM e2e: ${pass}/${total} PASS ${pass === total ? "✓" : "✗"} ================`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("\nharness error:", e); process.exit(2); });
