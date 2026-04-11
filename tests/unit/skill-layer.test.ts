import { describe, it, expect } from "bun:test";

import {
  defineSkill,
  createActivateSkillTool,
  formatSkillDescriptions,
  createSmartAgent,
} from "../../packages/ai/src/index.js";
import type {
  AgentSkill,
  AgentTool,
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  PromptContext,
} from "../../packages/ai/src/types.js";
import {
  composeSystemPrompt,
} from "../../packages/ai/src/loop/prompt-composer.js";

// ---------------------------------------------------------------------------
// Helper: create a mock LLM that returns a sequence of responses
// ---------------------------------------------------------------------------

function mockLLM(responses: string[], sink?: LLMMessage[][]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((m) => ({ ...m })));
      const content = responses[callIndex] ?? "done";
      callIndex++;
      return { content, model: "mock-1" };
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: create a minimal skill for testing
// ---------------------------------------------------------------------------

function makeSkill(overrides?: Partial<AgentSkill>): AgentSkill {
  return {
    name: "code-review",
    description: "Reviews code for quality and correctness",
    trigger: "When the user asks for a code review or quality check",
    prompt: "You are now in code review mode. Analyze the code carefully for bugs, style issues, and potential improvements.",
    ...overrides,
  };
}

// ===========================================================================
// Section 1: defineSkill
// ===========================================================================

describe("defineSkill", () => {
  it("sets default source to 'developer'", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
    });
    expect(skill.source).toBe("developer");
  });

  it("sets default utility to 1.0", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
    });
    expect(skill.utility).toBe(1.0);
  });

  it("preserves explicit source override", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
      source: "evolved",
    });
    expect(skill.source).toBe("evolved");
  });

  it("preserves explicit utility override", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
      utility: 0.5,
    });
    expect(skill.utility).toBe(0.5);
  });

  it("preserves all required fields", () => {
    const skill = defineSkill({
      name: "analysis",
      description: "Analyzes data",
      trigger: "When data analysis is needed",
      prompt: "Analyze the provided data thoroughly.",
    });
    expect(skill.name).toBe("analysis");
    expect(skill.description).toBe("Analyzes data");
    expect(skill.trigger).toBe("When data analysis is needed");
    expect(skill.prompt).toBe("Analyze the provided data thoroughly.");
  });

  it("preserves optional tools array", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
      tools: ["search", "read_file"],
    });
    expect(skill.tools).toEqual(["search", "read_file"]);
  });

  it("preserves optional metadata", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
      metadata: { version: 2, author: "test" },
    });
    expect(skill.metadata).toEqual({ version: 2, author: "test" });
  });

  it("does not set tools or metadata when not provided", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
    });
    expect(skill.tools).toBeUndefined();
    expect(skill.metadata).toBeUndefined();
  });

  it("preserves developer source", () => {
    const skill = defineSkill({
      name: "test",
      description: "A test skill",
      trigger: "When testing",
      prompt: "Test prompt",
      source: "developer",
    });
    expect(skill.source).toBe("developer");
  });
});

// ===========================================================================
// Section 2: createActivateSkillTool
// ===========================================================================

describe("createActivateSkillTool", () => {
  const skills: AgentSkill[] = [
    makeSkill({ name: "code-review" }),
    makeSkill({
      name: "debug",
      description: "Debugs issues",
      trigger: "When debugging is needed",
      prompt: "Enter debug mode. Trace the issue step by step.",
      tools: ["read_file", "search", "run_tests"],
    }),
  ];

  it("returns an AgentTool with correct name", () => {
    const tool = createActivateSkillTool(skills);
    expect(tool.name).toBe("activate_skill");
  });

  it("returns an AgentTool with a descriptive description", () => {
    const tool = createActivateSkillTool(skills);
    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it("is marked isConcurrencySafe=true", () => {
    const tool = createActivateSkillTool(skills);
    expect(tool.isConcurrencySafe).toBe(true);
  });

  it("parameters include skill_name property", () => {
    const tool = createActivateSkillTool(skills);
    const params = tool.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;
    const skillNameProp = properties.skill_name as Record<string, unknown>;
    expect(skillNameProp).toBeDefined();
    expect(skillNameProp.type).toBe("string");
  });

  it("parameters require skill_name field", () => {
    const tool = createActivateSkillTool(skills);
    const params = tool.parameters as Record<string, unknown>;
    expect(params.required).toEqual(["skill_name"]);
  });

  it("execute with existing skill returns skill, guidance, and preferredTools", async () => {
    const tool = createActivateSkillTool(skills);
    const result = (await tool.execute({ skill_name: "code-review" })) as Record<string, unknown>;

    expect(result.skill).toBe("code-review");
    expect(result.guidance).toBe(
      "You are now in code review mode. Analyze the code carefully for bugs, style issues, and potential improvements.",
    );
    expect(result.preferredTools).toEqual([]);
  });

  it("execute with skill having tools returns populated preferredTools", async () => {
    const tool = createActivateSkillTool(skills);
    const result = (await tool.execute({ skill_name: "debug" })) as Record<string, unknown>;

    expect(result.skill).toBe("debug");
    expect(result.guidance).toBe("Enter debug mode. Trace the issue step by step.");
    expect(result.preferredTools).toEqual(["read_file", "search", "run_tests"]);
  });

  it("execute with missing skill returns error with available skill names", async () => {
    const tool = createActivateSkillTool(skills);
    const result = (await tool.execute({ skill_name: "nonexistent" })) as Record<string, unknown>;

    expect(result.error).toBeDefined();
    expect(result.error as string).toContain("nonexistent");
    expect(result.error as string).toContain("code-review");
    expect(result.error as string).toContain("debug");
  });

  it("works with a single skill", () => {
    const tool = createActivateSkillTool([makeSkill()]);
    expect(tool.description).toContain("code-review");
  });

  it("works with empty skills array", () => {
    const tool = createActivateSkillTool([]);
    const params = tool.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;
    const skillNameProp = properties.skill_name as Record<string, unknown>;
    expect(skillNameProp).toBeDefined();
    expect(skillNameProp.type).toBe("string");
  });
});

// ===========================================================================
// Section 3: formatSkillDescriptions
// ===========================================================================

describe("formatSkillDescriptions", () => {
  it("returns empty string for empty array", () => {
    expect(formatSkillDescriptions([])).toBe("");
  });

  it("includes 'Available Skills' header for non-empty array", () => {
    const result = formatSkillDescriptions([makeSkill()]);
    expect(result).toContain("## Available Skills");
  });

  it("includes activate_skill tool reference", () => {
    const result = formatSkillDescriptions([makeSkill()]);
    expect(result).toContain("activate_skill");
  });

  it("lists skill name with trigger text", () => {
    const skill = makeSkill({
      name: "code-review",
      trigger: "When the user asks for a code review or quality check",
    });
    const result = formatSkillDescriptions([skill]);
    expect(result).toContain("code-review");
    expect(result).toContain("When the user asks for a code review or quality check");
  });

  it("formats multiple skills correctly", () => {
    const skills: AgentSkill[] = [
      makeSkill({ name: "code-review", trigger: "Code review trigger" }),
      makeSkill({ name: "debug", trigger: "Debug trigger" }),
      makeSkill({ name: "deploy", trigger: "Deploy trigger" }),
    ];
    const result = formatSkillDescriptions(skills);

    expect(result).toContain("code-review");
    expect(result).toContain("Code review trigger");
    expect(result).toContain("debug");
    expect(result).toContain("Debug trigger");
    expect(result).toContain("deploy");
    expect(result).toContain("Deploy trigger");
  });

  it("does not truncate long trigger text", () => {
    const longTrigger = "A".repeat(500);
    const skill = makeSkill({ trigger: longTrigger });
    const result = formatSkillDescriptions([skill]);
    expect(result).toContain(longTrigger);
  });

  it("uses markdown bold for skill names", () => {
    const result = formatSkillDescriptions([makeSkill({ name: "my-skill" })]);
    expect(result).toContain("**my-skill**");
  });
});

// ===========================================================================
// Section 4: Prompt integration (composeSystemPrompt)
// ===========================================================================

describe("Prompt integration — skills injected as layer via composeSystemPrompt", () => {
  const baseContext: PromptContext = {
    tools: [],
    iteration: 0,
    memories: [],
    tokenBudget: 100_000,
  };

  /**
   * The engine injects skills as a prompt layer (id: "skills-catalog", position: "append", priority: 85).
   * The prompt-composer itself does NOT have built-in skill support.
   * These tests replicate the engine's layer injection pattern.
   */
  function buildSkillsLayer(skills: AgentSkill[]) {
    const content = formatSkillDescriptions(skills);
    if (!content) return undefined;
    return {
      id: "skills-catalog",
      content,
      position: "append" as const,
      priority: 85,
    };
  }

  it("includes skill section when skills layer is injected", () => {
    const layer = buildSkillsLayer([makeSkill()]);
    const result = composeSystemPrompt(
      { layers: layer ? [layer] : [] },
      baseContext,
    );
    expect(result).toContain("## Available Skills");
    expect(result).toContain("code-review");
  });

  it("does NOT include skill section when no skills", () => {
    const result = composeSystemPrompt(undefined, baseContext);
    expect(result).not.toContain("## Available Skills");
  });

  it("does NOT include skill section when skills is empty array", () => {
    const layer = buildSkillsLayer([]);
    // buildSkillsLayer returns undefined for empty array since formatSkillDescriptions returns ""
    expect(layer).toBeUndefined();
    const result = composeSystemPrompt(
      { layers: [] },
      baseContext,
    );
    expect(result).not.toContain("## Available Skills");
  });

  it("does NOT include skill section when no layer is provided", () => {
    const result = composeSystemPrompt(undefined, baseContext);
    expect(result).not.toContain("## Available Skills");
  });

  it("skill section appears after memory section", () => {
    const ctx: PromptContext = {
      ...baseContext,
      memories: ["User prefers TypeScript."],
    };
    const layer = buildSkillsLayer([makeSkill()])!;
    const result = composeSystemPrompt({ layers: [layer] }, ctx);
    const memIdx = result.indexOf("## Relevant Memories");
    const skillIdx = result.indexOf("## Available Skills");
    expect(memIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeGreaterThan(memIdx);
  });

  it("skill section appears after tool section", () => {
    const tool: AgentTool = {
      name: "search",
      description: "Search",
      async execute() { return {}; },
    };
    const ctx: PromptContext = {
      ...baseContext,
      tools: [tool],
    };
    const layer = buildSkillsLayer([makeSkill()])!;
    const result = composeSystemPrompt({ layers: [layer] }, ctx);
    const toolIdx = result.indexOf("## Available Tools");
    const skillIdx = result.indexOf("## Available Skills");
    expect(toolIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeGreaterThan(toolIdx);
  });

  it("skill section appears before lower-priority append layers", () => {
    const skillLayer = buildSkillsLayer([makeSkill()])!;
    const footerLayer = { id: "footer", content: "FOOTER_LAYER", position: "append" as const, priority: 1 };
    const result = composeSystemPrompt(
      { layers: [footerLayer, skillLayer] },
      baseContext,
    );
    const skillIdx = result.indexOf("## Available Skills");
    const footerIdx = result.indexOf("FOOTER_LAYER");
    expect(skillIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeLessThan(footerIdx);
  });

  it("skills with long triggers are not truncated", () => {
    const longTrigger = "X".repeat(1000);
    const ctx: PromptContext = {
      ...baseContext,
      tokenBudget: 1_000_000,
    };
    const layer = buildSkillsLayer([makeSkill({ trigger: longTrigger })])!;
    const result = composeSystemPrompt({ layers: [layer] }, ctx);
    expect(result).toContain(longTrigger);
  });

  it("multiple skills all appear in system prompt", () => {
    const skills = [
      makeSkill({ name: "review", trigger: "Review trigger" }),
      makeSkill({ name: "deploy", trigger: "Deploy trigger" }),
      makeSkill({ name: "debug", trigger: "Debug trigger" }),
    ];
    const layer = buildSkillsLayer(skills)!;
    const result = composeSystemPrompt({ layers: [layer] }, baseContext);
    expect(result).toContain("review");
    expect(result).toContain("deploy");
    expect(result).toContain("debug");
  });
});

// ===========================================================================
// Section 5: Agent integration (with mock LLM)
// ===========================================================================

describe("Agent integration — skills with createSmartAgent", () => {
  it("agent with skills has activate_skill in the system prompt tool list", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const skill = makeSkill();

    const agent = createSmartAgent({
      llm: mockLLM(["All done."], capturedMessages),
      tools: [],
      skills: [skill],
    });

    await agent.run("Do something");

    // System prompt should mention activate_skill as a tool
    const systemMsg = capturedMessages[0]![0]!;
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("activate_skill");
  });

  it("agent can call activate_skill and gets skill prompt as tool result", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const skill = makeSkill({
      prompt: "You are in code review mode now.",
    });

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "code-review" } }),
          "Code review complete.",
        ],
        capturedMessages,
      ),
      tools: [],
      skills: [skill],
    });

    const result = await agent.run("Review my code");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("Code review complete.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("activate_skill");
  });

  it("skill prompt appears in subsequent LLM calls after activation", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const skill = makeSkill({
      prompt: "SKILL_GUIDANCE_MARKER",
    });

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "code-review" } }),
          "Done.",
        ],
        capturedMessages,
      ),
      tools: [],
      skills: [skill],
    });

    await agent.run("Review");

    // The second LLM call should include the tool result containing the guidance
    expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
    const secondCallMessages = capturedMessages[1]!;
    const toolResultMsg = secondCallMessages.find(
      (m) => m.role === "user" && m.content.includes("SKILL_GUIDANCE_MARKER"),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it("agent with no skills does NOT have activate_skill tool", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const agent = createSmartAgent({
      llm: mockLLM(["All done."], capturedMessages),
      tools: [],
    });

    await agent.run("Do something");

    const systemMsg = capturedMessages[0]![0]!;
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).not.toContain("activate_skill");
  });

  it("agent with empty skills array does NOT have activate_skill tool", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const agent = createSmartAgent({
      llm: mockLLM(["All done."], capturedMessages),
      tools: [],
      skills: [],
    });

    await agent.run("Do something");

    const systemMsg = capturedMessages[0]![0]!;
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).not.toContain("activate_skill");
  });

  it("multiple skills: agent can activate any of them", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const skills: AgentSkill[] = [
      makeSkill({ name: "review", prompt: "REVIEW_MODE" }),
      makeSkill({ name: "debug", prompt: "DEBUG_MODE" }),
    ];

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "debug" } }),
          "Debugging complete.",
        ],
        capturedMessages,
      ),
      tools: [],
      skills,
    });

    const result = await agent.run("Debug this");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("activate_skill");

    // The tool result should contain the debug skill guidance, not review
    const secondCallMessages = capturedMessages[1]!;
    const toolResultMsg = secondCallMessages.find(
      (m) => m.role === "user" && m.content.includes("DEBUG_MODE"),
    );
    expect(toolResultMsg).toBeDefined();

    const reviewMsg = secondCallMessages.find(
      (m) => m.role === "user" && m.content.includes("REVIEW_MODE"),
    );
    expect(reviewMsg).toBeUndefined();
  });

  it("activated skill's preferredTools field is populated correctly", async () => {
    const skills: AgentSkill[] = [
      makeSkill({
        name: "deploy",
        prompt: "Deploy mode activated.",
        tools: ["run_command", "upload"],
      }),
    ];

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "deploy" } }),
        "Deployed.",
      ]),
      tools: [],
      skills,
    });

    const result = await agent.run("Deploy");

    expect(result.toolCalls).toHaveLength(1);
    const activateResult = result.toolCalls[0]!.result as Record<string, unknown>;
    expect(activateResult.preferredTools).toEqual(["run_command", "upload"]);
  });

  it("activating nonexistent skill returns error to agent", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const skills: AgentSkill[] = [makeSkill({ name: "review" })];

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "unknown-skill" } }),
          "Skill not found, proceeding without it.",
        ],
        capturedMessages,
      ),
      tools: [],
      skills,
    });

    const result = await agent.run("Activate something");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    const activateResult = result.toolCalls[0]!.result as Record<string, unknown>;
    expect(activateResult.error).toBeDefined();
    expect(activateResult.error as string).toContain("unknown-skill");
    expect(activateResult.error as string).toContain("review");
  });

  it("skills coexist with regular tools", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const addTool: AgentTool = {
      name: "add",
      description: "Adds two numbers",
      parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
      async execute(args) {
        return (args.a as number) + (args.b as number);
      },
    };

    const skills: AgentSkill[] = [
      makeSkill({ name: "math-mode", prompt: "You are in math mode." }),
    ];

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "math-mode" } }),
          JSON.stringify({ tool: "add", arguments: { a: 2, b: 3 } }),
          "The sum is 5.",
        ],
        capturedMessages,
      ),
      tools: [addTool],
      skills,
    });

    const result = await agent.run("Add 2 and 3 in math mode");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.tool).toBe("activate_skill");
    expect(result.toolCalls[1]!.tool).toBe("add");
    expect(result.toolCalls[1]!.result).toBe(5);
  });

  it("system prompt lists all skills with their triggers", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const skills: AgentSkill[] = [
      makeSkill({ name: "alpha", trigger: "Alpha trigger" }),
      makeSkill({ name: "beta", trigger: "Beta trigger" }),
    ];

    const agent = createSmartAgent({
      llm: mockLLM(["Done."], capturedMessages),
      tools: [],
      skills,
    });

    await agent.run("test");

    const systemMsg = capturedMessages[0]![0]!;
    expect(systemMsg.content).toContain("alpha");
    expect(systemMsg.content).toContain("Alpha trigger");
    expect(systemMsg.content).toContain("beta");
    expect(systemMsg.content).toContain("Beta trigger");
  });
});
