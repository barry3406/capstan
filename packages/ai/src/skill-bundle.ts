import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { AgentSkill, AgentTool, SkillFile } from "./types.js";

/**
 * Code-bearing skills (Anthropic "Agent Skills" style).
 *
 * A skill can be a DIRECTORY containing a `SKILL.md` (frontmatter + guidance
 * body) plus bundled scripts/resources. The agent activates the skill to
 * receive the guidance + a manifest of bundled files, then uses
 * `read_skill_file` / `run_skill_script` to inspect and execute them.
 *
 * Security: scripts only run from an ACTIVATED skill's bundle, the path is
 * confined to the bundle directory (no `..` escape), the interpreter is chosen
 * from an allowlist by extension, execution uses cwd=bundle with a timeout and
 * output caps. This still executes code on the host — run untrusted skills
 * inside an OS/container sandbox.
 */

const MAX_FILES = 200;
const MAX_DEPTH = 4;
const MANIFEST_MAX_BYTES = 2 * 1024 * 1024; // skip listing files larger than this
const READ_MAX_BYTES = 256 * 1024;
const OUTPUT_CAP = 100_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Interpreter allowlist, keyed by file extension. */
const INTERPRETERS: Record<string, string> = {
  ".py": "python3",
  ".sh": "bash",
  ".bash": "bash",
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".ts": "bun",
};

// ---------------------------------------------------------------------------
// Loading: SKILL.md + bundled files
// ---------------------------------------------------------------------------

interface ParsedSkillMd {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

/** Minimal frontmatter parser: a leading `---` block of `key: value` lines
 * (and inline `key: [a, b]` arrays). Everything after the closing `---` is the
 * guidance body. No YAML dependency. */
export function parseSkillMd(text: string): ParsedSkillMd {
  const normalized = text.replace(/\r\n/g, "\n");
  const fm: Record<string, string | string[]> = {};
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: fm, body: normalized.trim() };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: fm, body: normalized.trim() };
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "").trim();
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      fm[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      fm[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter: fm, body };
}

function enumerateFiles(bundleDir: string): SkillFile[] {
  const out: SkillFile[] = [];
  const root = resolve(bundleDir);
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (out.length >= MAX_FILES) return;
      if (name.startsWith(".") || name === "node_modules") continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1);
      } else if (st.isFile()) {
        if (st.size > MANIFEST_MAX_BYTES) continue;
        out.push({
          path: relative(root, abs).split(sep).join("/"),
          bytes: st.size,
          executable: (st.mode & 0o111) !== 0,
        });
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Load a single skill directory (must contain SKILL.md) into an AgentSkill. */
export function loadSkill(dir: string): AgentSkill {
  const bundleDir = resolve(dir);
  const mdPath = join(bundleDir, "SKILL.md");
  let parsed: ParsedSkillMd;
  try {
    parsed = parseSkillMd(readFileSync(mdPath, "utf-8"));
  } catch {
    throw new Error(`skill bundle at ${bundleDir} is missing a readable SKILL.md`);
  }
  const fm = parsed.frontmatter;
  const str = (k: string): string | undefined => (typeof fm[k] === "string" ? (fm[k] as string) : undefined);
  const name = str("name") || basename(bundleDir);
  const files = enumerateFiles(bundleDir);
  return {
    name,
    description: str("description") || name,
    trigger: str("trigger") || str("description") || `Use the ${name} skill.`,
    prompt: parsed.body,
    ...(Array.isArray(fm["tools"]) ? { tools: fm["tools"] as string[] } : {}),
    source: "developer",
    utility: 1.0,
    bundleDir,
    files,
  };
}

/** Load every immediate sub-directory of `parentDir` that contains a SKILL.md. */
export function loadSkillsFrom(parentDir: string): AgentSkill[] {
  const root = resolve(parentDir);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const skills: AgentSkill[] = [];
  for (const name of entries.sort()) {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      statSync(join(dir, "SKILL.md"));
    } catch {
      continue;
    }
    skills.push(loadSkill(dir));
  }
  return skills;
}

// ---------------------------------------------------------------------------
// Execution tools (shared activation state)
// ---------------------------------------------------------------------------

function confine(bundleDir: string, rel: string): string | null {
  if (typeof rel !== "string" || !rel.trim()) return null;
  const root = resolve(bundleDir);
  const abs = resolve(root, rel);
  if (abs === root || abs.startsWith(root + sep)) return abs;
  return null;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runScript(interp: string, scriptAbs: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(interp, [scriptAbs, ...args], { cwd, env: process.env });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      if (out.length < OUTPUT_CAP) out += d.toString("utf-8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < OUTPUT_CAP) err += d.toString("utf-8");
    });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolveRun({ exitCode: -1, stdout: out.slice(0, OUTPUT_CAP), stderr: `${err}\n${e.message}`.slice(0, OUTPUT_CAP), timedOut });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolveRun({ exitCode: code ?? -1, stdout: out.slice(0, OUTPUT_CAP), stderr: err.slice(0, OUTPUT_CAP), timedOut });
    });
  });
}

export interface SkillToolsOptions {
  /** Override the per-script timeout (ms). Default 30000. */
  scriptTimeoutMs?: number;
}

/**
 * Build the skill tool-set: `activate_skill` plus, when any skill carries a
 * code bundle, `read_skill_file` and `run_skill_script`. The three tools share
 * activation state so a script can only run AFTER its skill is activated.
 *
 * Drop-in superset of `createActivateSkillTool` — the loop uses this so both
 * guidance-only and code-bearing skills work.
 */
export function createSkillTools(skills: AgentSkill[], options: SkillToolsOptions = {}): AgentTool[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const activated = new Set<string>();
  const timeoutMs = options.scriptTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hasBundle = skills.some((s) => s.bundleDir);

  const activate: AgentTool = {
    name: "activate_skill",
    description:
      "Activate a skill by name to receive specialized guidance" +
      (hasBundle ? " (and, for code-bearing skills, the list of bundled files you can read/run). " : ". ") +
      "Available skills: " +
      skills.map((s) => `${s.name} (${s.trigger})`).join(", "),
    parameters: {
      type: "object",
      properties: { skill_name: { type: "string", description: "The name of the skill to activate" } },
      required: ["skill_name"],
    },
    isConcurrencySafe: true,
    failureMode: "soft",
    async execute(args) {
      const name = args["skill_name"] as string | undefined;
      if (!name) return { error: "skill_name is required" };
      const skill = byName.get(name);
      if (!skill) return { error: `Skill "${name}" not found. Available: ${[...byName.keys()].join(", ")}` };
      activated.add(name);
      const base = {
        skill: skill.name,
        description: skill.description,
        guidance: skill.prompt,
        preferredTools: skill.tools ?? [],
      };
      if (skill.bundleDir && skill.files && skill.files.length > 0) {
        return {
          ...base,
          files: skill.files,
          note:
            "This skill bundles files. Use read_skill_file to inspect one, and " +
            "run_skill_script to execute a script (e.g. .py/.sh/.js) from this bundle.",
        };
      }
      return base;
    },
  };

  const tools: AgentTool[] = [activate];
  if (!hasBundle) return tools;

  const requireActivatedBundle = (name: unknown): { skill: AgentSkill } | { error: string } => {
    if (typeof name !== "string" || !name) return { error: "skill is required" };
    const skill = byName.get(name);
    if (!skill || !skill.bundleDir) return { error: `Skill "${name}" is not a code-bearing skill.` };
    if (!activated.has(name)) return { error: `Activate the "${name}" skill first (call activate_skill).` };
    return { skill };
  };

  tools.push({
    name: "read_skill_file",
    description: "Read a text file bundled with an ACTIVATED code-bearing skill (e.g. a script or resource), so you can inspect it before running.",
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string", description: "The activated skill's name" },
        path: { type: "string", description: "Bundle-relative file path (e.g. scripts/extract.py)" },
      },
      required: ["skill", "path"],
    },
    isConcurrencySafe: true,
    failureMode: "soft",
    async execute(args) {
      const gate = requireActivatedBundle(args["skill"]);
      if ("error" in gate) return gate;
      const abs = confine(gate.skill.bundleDir!, args["path"] as string);
      if (!abs) return { error: `Path escapes the skill bundle or is invalid: ${String(args["path"])}` };
      try {
        const st = statSync(abs);
        if (!st.isFile()) return { error: "Not a file." };
        const buf = readFileSync(abs);
        const truncated = buf.length > READ_MAX_BYTES;
        return {
          path: args["path"],
          bytes: st.size,
          content: buf.subarray(0, READ_MAX_BYTES).toString("utf-8"),
          ...(truncated ? { truncated: true } : {}),
        };
      } catch (e) {
        return { error: `Cannot read file: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  tools.push({
    name: "run_skill_script",
    description:
      "Execute a script bundled with an ACTIVATED code-bearing skill, inside the skill's directory. " +
      "Supported by extension: .py (python3), .sh (bash), .js/.mjs/.cjs (node), .ts (bun). " +
      "Returns exitCode, stdout, stderr. Activate the skill first.",
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string", description: "The activated skill's name" },
        script: { type: "string", description: "Bundle-relative script path (e.g. scripts/extract.py)" },
        args: { type: "array", description: "Optional string arguments passed to the script" },
      },
      required: ["skill", "script"],
    },
    isConcurrencySafe: false,
    failureMode: "soft",
    async execute(args) {
      const gate = requireActivatedBundle(args["skill"]);
      if ("error" in gate) return gate;
      const bundleDir = gate.skill.bundleDir!;
      const abs = confine(bundleDir, args["script"] as string);
      if (!abs) return { error: `Script path escapes the skill bundle or is invalid: ${String(args["script"])}` };
      const ext = extname(abs).toLowerCase();
      const interp = INTERPRETERS[ext];
      if (!interp) {
        return { error: `Unsupported script type "${ext}". Allowed: ${Object.keys(INTERPRETERS).join(", ")}` };
      }
      try {
        if (!statSync(abs).isFile()) return { error: "Script is not a file." };
      } catch {
        return { error: `Script not found: ${String(args["script"])}` };
      }
      const scriptArgs = Array.isArray(args["args"]) ? (args["args"] as unknown[]).map((a) => String(a)) : [];
      const result = await runScript(interp, abs, scriptArgs, bundleDir, timeoutMs);
      return {
        script: args["script"],
        interpreter: interp,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.timedOut ? { timedOut: true, error: `Script timed out after ${timeoutMs}ms` } : {}),
      };
    },
  });

  return tools;
}
