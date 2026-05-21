import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSkill,
  loadSkillsFrom,
  createSkillTools,
  parseSkillMd,
} from "../../packages/ai/src/skill-bundle.ts";
import type { AgentTool } from "../../packages/ai/src/types.ts";

let root = "";
let skillDir = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "capstan-skills-"));
  skillDir = join(root, "calc-pro");
  mkdirSync(join(skillDir, "scripts"), { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: calc-pro
description: Precise arithmetic via bundled scripts.
trigger: Use when the user needs exact computation.
tools: [run_skill_script, read_skill_file]
---
Use scripts/compute.py to compute exact results. Pass the operands as args.`,
  );
  // python: echo argv or a fixed token
  writeFileSync(
    join(skillDir, "scripts", "compute.py"),
    `import sys\nprint("RESULT=" + (sys.argv[1] if len(sys.argv) > 1 else "noarg"))\n`,
  );
  // shell: fixed output
  const sh = join(skillDir, "scripts", "hello.sh");
  writeFileSync(sh, `#!/usr/bin/env bash\necho "SH_OK"\n`);
  chmodSync(sh, 0o755);
  // a resource file
  writeFileSync(join(skillDir, "NOTES.txt"), "secret-resource-content");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const tool = (tools: AgentTool[], name: string): AgentTool => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("parseSkillMd", () => {
  it("parses frontmatter (incl. inline array) and body", () => {
    const { frontmatter, body } = parseSkillMd(
      `---\nname: x\ntrigger: do x\ntools: [a, b]\n---\nguidance body here`,
    );
    expect(frontmatter.name).toBe("x");
    expect(frontmatter.trigger).toBe("do x");
    expect(frontmatter.tools).toEqual(["a", "b"]);
    expect(body).toBe("guidance body here");
  });
  it("treats a file with no frontmatter as pure body", () => {
    const { frontmatter, body } = parseSkillMd("just guidance");
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toBe("just guidance");
  });
});

describe("loadSkill", () => {
  it("loads SKILL.md + file manifest", () => {
    const s = loadSkill(skillDir);
    expect(s.name).toBe("calc-pro");
    expect(s.trigger).toContain("exact computation");
    expect(s.prompt).toContain("scripts/compute.py");
    expect(s.bundleDir).toBe(require("node:path").resolve(skillDir));
    const paths = (s.files ?? []).map((f) => f.path).sort();
    expect(paths).toContain("scripts/compute.py");
    expect(paths).toContain("scripts/hello.sh");
    expect(paths).toContain("NOTES.txt");
    expect((s.files ?? []).find((f) => f.path === "scripts/hello.sh")!.executable).toBe(true);
  });
  it("loadSkillsFrom discovers the bundle by SKILL.md", () => {
    const skills = loadSkillsFrom(root);
    expect(skills.map((s) => s.name)).toContain("calc-pro");
  });
});

describe("createSkillTools — code-bearing", () => {
  it("exposes activate_skill + read_skill_file + run_skill_script", () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "activate_skill",
      "read_skill_file",
      "run_skill_script",
    ]);
  });

  it("run_skill_script is BLOCKED before activation", async () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    const res = (await tool(tools, "run_skill_script").execute({ skill: "calc-pro", script: "scripts/compute.py" })) as { error?: string };
    expect(res.error).toContain("Activate");
  });

  it("activate then run executes the bundled script with args", async () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    const act = (await tool(tools, "activate_skill").execute({ skill_name: "calc-pro" })) as { skill: string; files?: unknown[] };
    expect(act.skill).toBe("calc-pro");
    expect(Array.isArray(act.files)).toBe(true);

    const run = (await tool(tools, "run_skill_script").execute({ skill: "calc-pro", script: "scripts/compute.py", args: ["hello42"] })) as { exitCode: number; stdout: string };
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe("RESULT=hello42");
  });

  it("runs a shell script too", async () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    await tool(tools, "activate_skill").execute({ skill_name: "calc-pro" });
    const run = (await tool(tools, "run_skill_script").execute({ skill: "calc-pro", script: "scripts/hello.sh" })) as { exitCode: number; stdout: string };
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe("SH_OK");
  });

  it("read_skill_file returns bundled resource content", async () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    await tool(tools, "activate_skill").execute({ skill_name: "calc-pro" });
    const r = (await tool(tools, "read_skill_file").execute({ skill: "calc-pro", path: "NOTES.txt" })) as { content: string };
    expect(r.content).toBe("secret-resource-content");
  });

  it("BLOCKS path traversal out of the bundle", async () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    await tool(tools, "activate_skill").execute({ skill_name: "calc-pro" });
    const run = (await tool(tools, "run_skill_script").execute({ skill: "calc-pro", script: "../../../../../../bin/sh" })) as { error?: string };
    expect(run.error).toMatch(/escapes the skill bundle/);
    const read = (await tool(tools, "read_skill_file").execute({ skill: "calc-pro", path: "../../../etc/hosts" })) as { error?: string };
    expect(read.error).toMatch(/escapes the skill bundle/);
  });

  it("REJECTS unsupported interpreters", async () => {
    const tools = createSkillTools([loadSkill(skillDir)]);
    await tool(tools, "activate_skill").execute({ skill_name: "calc-pro" });
    writeFileSync(join(skillDir, "evil.rb"), "puts 1");
    const run = (await tool(tools, "run_skill_script").execute({ skill: "calc-pro", script: "evil.rb" })) as { error?: string };
    expect(run.error).toMatch(/Unsupported script type/);
  });
});

describe("createSkillTools — guidance-only (backward compat)", () => {
  it("returns ONLY activate_skill when no skill has a bundle", () => {
    const tools = createSkillTools([
      { name: "g", description: "d", trigger: "t", prompt: "just guidance" },
    ]);
    expect(tools.map((t) => t.name)).toEqual(["activate_skill"]);
  });
  it("activate_skill on a guidance-only skill returns guidance, no files", async () => {
    const tools = createSkillTools([
      { name: "g", description: "d", trigger: "t", prompt: "GUIDE_MARKER" },
    ]);
    const r = (await tool(tools, "activate_skill").execute({ skill_name: "g" })) as { guidance: string; files?: unknown };
    expect(r.guidance).toBe("GUIDE_MARKER");
    expect(r.files).toBeUndefined();
  });
});
