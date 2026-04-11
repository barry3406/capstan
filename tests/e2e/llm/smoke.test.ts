import { it, expect } from "bun:test";
import { createSmartAgent, defineSkill, createActivateSkillTool } from "../../../packages/ai/src/index.js";
import type { AgentTool } from "../../../packages/ai/src/types.js";
import { describeWithLLM } from "./helpers/env.js";
import {
  multiplyTool,
  addTool,
  getWeatherTool,
  searchDatabaseTool,
  formatTextTool,
} from "./helpers/tools.js";

// ---------------------------------------------------------------------------
// Smoke layer — 3-5 turn tests, 2 min timeout per case
// ---------------------------------------------------------------------------

describeWithLLM("Smoke — agent basics", (provider) => {

  it("calls a single tool correctly and uses the result", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "What is 17 multiplied by 23? Use the multiply tool to calculate this.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const call = result.toolCalls.find((c) => c.tool === "multiply");
    expect(call).toBeDefined();
    expect(call!.result).toBe(391);
    expect(result.result as string).toContain("391");
  }, 120_000);

  it("chains multiple tool calls using prior results", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "First multiply 6 by 7 using the multiply tool, then add 8 to that result using the add tool. Tell me the final number.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
    // 6*7 = 42, 42+8 = 50
    expect(result.result as string).toContain("50");
  }, 120_000);

  it("selects the correct tool from multiple options", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool, getWeatherTool, searchDatabaseTool, formatTextTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "What is the weather in Tokyo? Use the appropriate tool.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCalls[0]!.tool).toBe("get_weather");
  }, 120_000);

  it("responds directly when no tools are needed", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool],
      maxIterations: 10,
    });

    const result = await agent.run("Say hello in Japanese. Do not use any tools.");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.iterations).toBe(1);
    expect((result.result as string).length).toBeGreaterThan(0);
  }, 120_000);

  it("recovers when a tool throws an error", async () => {
    let callCount = 0;
    const flakyTool: AgentTool = {
      name: "fetch_data",
      description: "Fetches data for a query. May fail temporarily.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      async execute(args) {
        callCount++;
        if (callCount === 1) throw new Error("Connection timeout — service temporarily unavailable");
        return { data: `Results for: ${args.query}`, count: 3 };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [flakyTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "Fetch data about 'capstan framework' using the fetch_data tool. If it fails, try again.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
    const successes = result.toolCalls.filter((c) => c.status === "success");
    expect(successes.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("activates a skill when the task matches the skill trigger", async () => {
    const debugSkill = defineSkill({
      name: "debugging",
      description: "Systematic debugging methodology for finding and fixing errors",
      trigger: "when debugging errors, exceptions, or unexpected behavior",
      prompt:
        "Follow this debugging strategy:\n"
        + "1. Reproduce the error by calling the failing function\n"
        + "2. Read the error message carefully\n"
        + "3. Form a hypothesis about the root cause\n"
        + "4. Verify the hypothesis by testing with the check_value tool\n"
        + "5. Report your diagnosis",
    });

    const checkValueTool: AgentTool = {
      name: "check_value",
      description: "Check a value in the system for debugging purposes.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to check" },
        },
        required: ["key"],
      },
      async execute(args) {
        const key = args.key as string;
        if (key === "config.timeout") return { key, value: -1, note: "Negative timeout is invalid" };
        return { key, value: "ok" };
      },
    };

    const activateSkillTool = createActivateSkillTool([debugSkill]);

    const agent = createSmartAgent({
      llm: provider,
      tools: [checkValueTool, activateSkillTool],
      skills: [debugSkill],
      maxIterations: 15,
    });

    const result = await agent.run(
      "There is a bug: the system keeps timing out. Debug this issue. "
      + "First activate the debugging skill to get guidance, then use check_value with key 'config.timeout' to investigate.",
    );

    expect(result.status).toBe("completed");
    // Agent should have called activate_skill
    const skillCall = result.toolCalls.find((c) => c.tool === "activate_skill");
    expect(skillCall).toBeDefined();
    // The skill activation should have returned the guidance text
    const skillResult = skillCall!.result as Record<string, unknown>;
    expect(skillResult.skill).toBe("debugging");
    expect(skillResult.guidance).toContain("debugging strategy");
    // Agent should also have used the check_value tool after getting guidance
    const checkCall = result.toolCalls.find((c) => c.tool === "check_value");
    expect(checkCall).toBeDefined();
  }, 120_000);

  it("does not activate skills when task does not match", async () => {
    const debugSkill = defineSkill({
      name: "debugging",
      description: "Systematic debugging methodology for finding and fixing errors",
      trigger: "when debugging errors, exceptions, or unexpected behavior",
      prompt: "Follow this debugging strategy: reproduce, isolate, fix, verify.",
    });

    const activateSkillTool = createActivateSkillTool([debugSkill]);

    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool, activateSkillTool],
      skills: [debugSkill],
      maxIterations: 10,
    });

    const result = await agent.run(
      "What is 12 multiplied by 5? Use the multiply tool to calculate this. Do not activate any skills.",
    );

    expect(result.status).toBe("completed");
    // Agent should NOT have called activate_skill for a simple math task
    const skillCall = result.toolCalls.find((c) => c.tool === "activate_skill");
    expect(skillCall).toBeUndefined();
    // But should have used multiply
    const mulCall = result.toolCalls.find((c) => c.tool === "multiply");
    expect(mulCall).toBeDefined();
    expect(mulCall!.result).toBe(60);
    expect(result.result as string).toContain("60");
  }, 120_000);

});
