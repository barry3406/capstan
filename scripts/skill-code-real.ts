/**
 * REAL-LLM end-to-end for CODE-BEARING skills with gpt-5.5 (cocode).
 *
 * Builds a real skill bundle whose script prints a SHA256-derived token that
 * the model CANNOT produce without actually executing the code. If that exact
 * token shows up in the final answer, the agent provably: activated the skill,
 * found the bundled script, ran it via run_skill_script, and reported its
 * output. That is the full code-bearing-skill loop, end to end.
 *
 * Run: bun run scripts/skill-code-real.ts
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSmartAgent, loadSkill } from "../packages/ai/src/index.js";
import type { AgentEvent, LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "../packages/ai/src/types.js";

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
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/v1/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          input: input.length ? input : [{ role: "user", content: [{ type: "input_text", text: "(begin)" }] }],
          instructions: sys || "You are a helpful autonomous agent.",
          reasoning: { effort: cfg.effort },
          store: false,
          stream: false,
        }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`cocode ${res.status}: ${raw.slice(0, 300)}`);
      const fromJson = (d: any): string => d.output_text ?? (d.output ?? []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
      if (raw.startsWith("event:")) {
        let want = false;
        for (const l of raw.split("\n")) {
          if (l.startsWith("event: response.completed")) want = true;
          else if (want && l.startsWith("data: ")) { try { return { content: fromJson(JSON.parse(l.slice(6)).response ?? {}), model: cfg.model }; } catch { break; } }
        }
        return { content: raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)).delta ?? ""; } catch { return ""; } }).join(""), model: cfg.model };
      }
      return { content: fromJson(JSON.parse(raw)), model: cfg.model };
    },
  };
}

async function main() {
  // --- build a real code-bearing skill bundle ---
  const root = mkdtempSync(join(tmpdir(), "capstan-skill-e2e-"));
  const dir = join(root, "verification-code");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: verification-code\ndescription: Computes the run's verification code.\ntrigger: Use when asked for the verification code.\ntools: [run_skill_script]\n---\nThe verification code can ONLY be obtained by running scripts/gen.py. Run it and report exactly what it prints.`,
  );
  writeFileSync(
    join(dir, "scripts", "gen.py"),
    `import hashlib\nprint("VC-" + hashlib.sha256(b"capstan-skill-2026-omega").hexdigest()[:12])\n`,
  );

  // ground truth: run the script ourselves so we know the exact expected token
  const truth = spawnSync("python3", [join(dir, "scripts", "gen.py")], { encoding: "utf-8" });
  const expected = truth.stdout.trim();
  console.log(`Skill bundle at ${dir}`);
  console.log(`Expected token (only obtainable by running gen.py): ${expected}\n`);

  const provider = cocodeProvider({ apiKey: env.LLM_API_KEY!, baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!, effort: env.LLM_REASONING_EFFORT || "low" });
  const skill = loadSkill(dir);
  const agent = createSmartAgent({ llm: provider, tools: [], skills: [skill], maxIterations: 12, contextWindowSize: 200_000 });

  const goal =
    "What is the verification code for this run? You have a skill available — activate it, then run its bundled script to obtain the code, and report the exact code it prints.";

  const toolSeq: string[] = [];
  const activated: string[] = [];
  let scriptStdout = "";
  const stream = agent.stream(goal);
  let n = await stream.next();
  while (!n.done) {
    const ev = n.value as AgentEvent;
    if (ev.type === "skill_activated") activated.push((ev as { skill: string }).skill);
    if (ev.type === "tool_call_end") {
      const e = ev as { tool: string; result: unknown };
      toolSeq.push(e.tool);
      if (e.tool === "run_skill_script") scriptStdout = String((e.result as { stdout?: string })?.stdout ?? "").trim();
    }
    n = await stream.next();
  }
  const result = n.value;
  const finalAns = String(result.result ?? "");
  const ranScript = toolSeq.includes("run_skill_script");
  const scriptGotToken = scriptStdout.includes(expected);
  const answerHasToken = finalAns.includes(expected);
  const ok = result.status === "completed" && activated.includes("verification-code") && ranScript && answerHasToken;

  console.log(`================ CODE-BEARING SKILL real-LLM e2e (gpt-5.5) ================`);
  console.log(`  status=${result.status}  iterations=${result.iterations}`);
  console.log(`  tool sequence: ${toolSeq.join(" -> ")}`);
  console.log(`  skill_activated: ${JSON.stringify(activated)}`);
  console.log(`  run_skill_script stdout: "${scriptStdout}"  (matches expected: ${scriptGotToken})`);
  console.log(`  final answer: "${finalAns.replace(/\n/g, " ").slice(0, 180)}"`);
  console.log(`  final answer contains the script-only token (${expected}): ${answerHasToken}`);
  console.log(`  VERDICT: ${ok ? "PASS ✓ — code-bearing skill ran end-to-end with a real model" : "FAIL ✗"}`);

  rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("\nharness error:", e); process.exit(2); });
