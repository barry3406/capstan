# Skill Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Skill primitive — high-level strategies (PromptCommands) that agents can activate, distinct from low-level tools. Enables `defineSkill()` API and `activate_skill` synthetic tool.

**Architecture:** Skills are registered via `SmartAgentConfig.skills`. A synthetic `activate_skill` tool is auto-injected. Skill descriptions are added to the system prompt via `formatSkillDescriptions()`. When the agent calls `activate_skill`, the skill's full prompt is returned as the tool result.

**Tech Stack:** TypeScript, Bun test

---

## File Structure

```
packages/ai/src/
  types.ts                  MODIFY — add AgentSkill interface
  skill.ts                  CREATE — defineSkill(), createActivateSkillTool(), formatSkillDescriptions()
  loop/engine.ts            MODIFY — inject skills into prompt + tool set
  loop/prompt-composer.ts   MODIFY — add formatSkillDescriptions() call in composeSystemPrompt
  index.ts                  MODIFY — export defineSkill, AgentSkill

tests/unit/
  skill-layer.test.ts       CREATE — unit tests for skill injection, activation, prompt formatting
```

---

### Task 1: AgentSkill type + defineSkill helper

**Files:**
- Modify: `packages/ai/src/types.ts`
- Create: `packages/ai/src/skill.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Add AgentSkill interface to types.ts**

After `ToolCatalogConfig` in `packages/ai/src/types.ts`:

```typescript
// === Skill Layer ===
export interface AgentSkill {
  name: string;
  description: string;
  trigger: string;
  prompt: string;
  tools?: string[] | undefined;
  source?: "developer" | "evolved" | undefined;
  utility?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}
```

Add `skills?: AgentSkill[] | undefined;` to `SmartAgentConfig`.

- [ ] **Step 2: Create skill.ts**

```typescript
import type { AgentSkill, AgentTool } from "./types.js";

/**
 * Define a skill — a high-level strategy that the agent can activate.
 * Skills differ from tools: tools are operations (input → output),
 * skills are strategies (guidance for how to approach a class of problems).
 */
export function defineSkill(def: AgentSkill): AgentSkill {
  return {
    source: "developer",
    utility: 1.0,
    ...def,
  };
}

/**
 * Create the synthetic `activate_skill` tool that lets the agent invoke skills.
 */
export function createActivateSkillTool(skills: AgentSkill[]): AgentTool {
  return {
    name: "activate_skill",
    description:
      "Activate a skill to get strategic guidance for the current task. "
      + "Skills are high-level strategies for complex problems. "
      + `Available skills: ${skills.map((s) => s.name).join(", ")}`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name to activate",
          enum: skills.map((s) => s.name),
        },
      },
      required: ["name"],
    },
    isConcurrencySafe: true,
    async execute(args) {
      const name = args.name as string;
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        return {
          error: `Skill "${name}" not found. Available: ${skills.map((s) => s.name).join(", ")}`,
        };
      }
      return {
        skill: skill.name,
        guidance: skill.prompt,
        preferredTools: skill.tools ?? [],
      };
    },
  };
}

/**
 * Format skill descriptions for system prompt injection.
 */
export function formatSkillDescriptions(skills: AgentSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.trigger}`);
  return (
    "## Available Skills\n\n"
    + "Skills are high-level strategies you can activate with the activate_skill tool.\n\n"
    + lines.join("\n")
  );
}
```

- [ ] **Step 3: Export from index.ts**

Add to `packages/ai/src/index.ts`:

```typescript
export { defineSkill } from "./skill.js";
```

And add `AgentSkill` to the type export list.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/types.ts packages/ai/src/skill.ts packages/ai/src/index.ts
git commit -m "feat: add AgentSkill type, defineSkill helper, and activate_skill tool"
```

---

### Task 2: Integrate skills into engine + prompt

**Files:**
- Modify: `packages/ai/src/loop/engine.ts`
- Modify: `packages/ai/src/loop/prompt-composer.ts`

- [ ] **Step 1: Add skill section to composeSystemPrompt**

In `packages/ai/src/loop/prompt-composer.ts`, import and add `formatSkillDescriptions` to the prompt assembly. After the `formatMemorySection` call (line 74-77), add:

```typescript
  // Import at top of file
  import { formatSkillDescriptions } from "../skill.js";

  // In composeSystemPrompt, add after memorySection and before appendLayers:
  const skillSection = formatSkillDescriptions(context.skills ?? []);
  if (skillSection) {
    sections.push(skillSection);
  }
```

Update `PromptContext` in `types.ts` to include `skills`:

```typescript
export interface PromptContext {
  tools: AgentTool[];
  skills?: AgentSkill[] | undefined;  // NEW
  iteration: number;
  memories: string[];
  tokenBudget: number;
}
```

- [ ] **Step 2: Inject activate_skill tool and skills context in engine.ts**

In `packages/ai/src/loop/engine.ts`, after the tool catalog is built (line 83-85), inject the activate_skill tool if skills are configured:

```typescript
  import { createActivateSkillTool } from "../skill.js";

  // After: const allTools = catalog.discoverTool ? [...state.tools, catalog.discoverTool] : [...state.tools];
  if (config.skills && config.skills.length > 0) {
    allTools.push(createActivateSkillTool(config.skills));
  }
```

And pass skills to the prompt context (line 104-108):

```typescript
    const systemPrompt = composeSystemPrompt(promptConfig, {
      tools: state.tools,
      skills: config.skills,  // NEW
      iteration: 0,
      memories: memoryStrings,
      tokenBudget: Math.floor(state.contextWindowSize * 0.25),
    });
```

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/loop/engine.ts packages/ai/src/loop/prompt-composer.ts packages/ai/src/types.ts
git commit -m "feat: integrate skills into engine — prompt injection + activate_skill tool"
```

---

### Task 3: Tests

**Files:**
- Create: `tests/unit/skill-layer.test.ts`

- [ ] **Step 1: Write skill layer tests**

```typescript
import { describe, it, expect } from "bun:test";
import { createSmartAgent, defineSkill } from "../../packages/ai/src/index.js";
import type { LLMProvider, LLMMessage, LLMResponse, LLMOptions, AgentTool } from "../../packages/ai/src/types.js";
import { createActivateSkillTool, formatSkillDescriptions } from "../../packages/ai/src/skill.js";

function mockLLM(responses: string[], sink?: LLMMessage[][]): LLMProvider {
  let i = 0;
  return {
    name: "mock",
    async chat(msgs: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(msgs.map(m => ({ ...m })));
      return { content: responses[i++] ?? "done", model: "mock" };
    },
  };
}

describe("defineSkill", () => {
  it("sets default source and utility", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "when testing",
      prompt: "Do the test thing",
    });
    expect(skill.source).toBe("developer");
    expect(skill.utility).toBe(1.0);
    expect(skill.name).toBe("test");
  });

  it("preserves explicit source and utility", () => {
    const skill = defineSkill({
      name: "evolved",
      description: "An evolved skill",
      trigger: "always",
      prompt: "...",
      source: "evolved",
      utility: 0.8,
    });
    expect(skill.source).toBe("evolved");
    expect(skill.utility).toBe(0.8);
  });
});

describe("createActivateSkillTool", () => {
  it("returns skill prompt when activated", async () => {
    const skills = [
      defineSkill({ name: "debug", description: "Debug", trigger: "on bug", prompt: "Step 1: read logs" }),
    ];
    const tool = createActivateSkillTool(skills);
    const result = await tool.execute({ name: "debug" });
    expect(result).toEqual({
      skill: "debug",
      guidance: "Step 1: read logs",
      preferredTools: [],
    });
  });

  it("returns error for unknown skill", async () => {
    const tool = createActivateSkillTool([]);
    const result = await tool.execute({ name: "nonexistent" }) as any;
    expect(result.error).toContain("not found");
  });
});

describe("formatSkillDescriptions", () => {
  it("formats skills into markdown", () => {
    const skills = [
      defineSkill({ name: "tdd", description: "TDD", trigger: "when tests fail", prompt: "..." }),
      defineSkill({ name: "review", description: "Review", trigger: "when reviewing code", prompt: "..." }),
    ];
    const section = formatSkillDescriptions(skills);
    expect(section).toContain("## Available Skills");
    expect(section).toContain("tdd: when tests fail");
    expect(section).toContain("review: when reviewing code");
  });

  it("returns empty string for no skills", () => {
    expect(formatSkillDescriptions([])).toBe("");
  });
});

describe("Skill integration in agent", () => {
  it("agent can activate a skill via tool call", async () => {
    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "activate_skill", arguments: { name: "debug" } }),
        "Fixed the bug using the debug strategy.",
      ], sink),
      tools: [],
      skills: [
        defineSkill({
          name: "debug",
          description: "Debug strategy",
          trigger: "when debugging",
          prompt: "1. Read logs\n2. Reproduce\n3. Fix\n4. Test",
        }),
      ],
    });

    const result = await agent.run("Fix the bug");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("activate_skill");
    // The skill guidance should appear in the messages sent to LLM
    const secondCall = sink[1]!;
    const skillResult = secondCall.find(m => m.content.includes("Step 1: Read logs") || m.content.includes("Read logs"));
    expect(skillResult).toBeDefined();
  });

  it("system prompt includes skill descriptions", async () => {
    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM(["Done."], sink),
      tools: [],
      skills: [
        defineSkill({ name: "plan", description: "Planning", trigger: "before complex tasks", prompt: "..." }),
      ],
    });

    await agent.run("Do something");
    const systemPrompt = sink[0]![0]!.content;
    expect(systemPrompt).toContain("Available Skills");
    expect(systemPrompt).toContain("plan: before complex tasks");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/skill-layer.test.ts
```

Expected: PASS

- [ ] **Step 3: Run full suite for regressions**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/skill-layer.test.ts
git commit -m "test: add skill layer unit tests — defineSkill, activation, prompt integration"
```
