import { describe, expect, it } from "bun:test";

import type {
  PromptComposerConfig,
  PromptContext,
  PromptLayer,
  AgentTool,
} from "../../packages/ai/src/types.ts";
import {
  composeSystemPrompt,
  formatToolDescriptions,
  formatMemorySection,
  DEFAULT_BASE_PROMPT,
} from "../../packages/ai/src/loop/prompt-composer.ts";

function makeTool(name: string, description: string): AgentTool {
  return {
    name,
    description,
    async execute() {
      return {};
    },
  };
}

const baseContext: PromptContext = {
  tools: [],
  iteration: 0,
  memories: [],
  tokenBudget: 100_000,
};

describe("composeSystemPrompt", () => {
  it("returns default base prompt when no config provided", () => {
    const result = composeSystemPrompt(undefined, baseContext);
    expect(result).toContain(DEFAULT_BASE_PROMPT);
  });

  it("custom base prompt replaces default", () => {
    const config: PromptComposerConfig = { base: "You are a helpful bot." };
    const result = composeSystemPrompt(config, baseContext);
    expect(result).toContain("You are a helpful bot.");
    expect(result).not.toContain(DEFAULT_BASE_PROMPT);
  });

  it("prepend layers appear before base", () => {
    const config: PromptComposerConfig = {
      layers: [
        { id: "safety", content: "Always be safe.", position: "prepend" },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    const safetyIdx = result.indexOf("Always be safe.");
    const baseIdx = result.indexOf(DEFAULT_BASE_PROMPT);
    expect(safetyIdx).toBeLessThan(baseIdx);
  });

  it("append layers appear after base", () => {
    const config: PromptComposerConfig = {
      layers: [
        { id: "footer", content: "Remember to be concise.", position: "append" },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    const footerIdx = result.indexOf("Remember to be concise.");
    const baseIdx = result.indexOf(DEFAULT_BASE_PROMPT);
    expect(footerIdx).toBeGreaterThan(baseIdx);
  });

  it("replace_base layer replaces the base entirely", () => {
    const config: PromptComposerConfig = {
      base: "Original base.",
      layers: [
        { id: "override", content: "New base prompt.", position: "replace_base", priority: 10 },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    expect(result).toContain("New base prompt.");
    expect(result).not.toContain("Original base.");
  });

  it("multiple layers sorted by priority (higher priority = earlier within same position)", () => {
    const config: PromptComposerConfig = {
      layers: [
        { id: "low", content: "LOW_PRIORITY", position: "prepend", priority: 1 },
        { id: "high", content: "HIGH_PRIORITY", position: "prepend", priority: 10 },
        { id: "mid", content: "MID_PRIORITY", position: "prepend", priority: 5 },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    const highIdx = result.indexOf("HIGH_PRIORITY");
    const midIdx = result.indexOf("MID_PRIORITY");
    const lowIdx = result.indexOf("LOW_PRIORITY");
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it("memory section appended when memories array is non-empty", () => {
    const ctx: PromptContext = {
      ...baseContext,
      memories: ["User prefers dark mode.", "User speaks English."],
    };
    const result = composeSystemPrompt(undefined, ctx);
    expect(result).toContain("## Relevant Memories");
    expect(result).toContain("User prefers dark mode.");
    expect(result).toContain("User speaks English.");
  });

  it("no memory section when memories array is empty", () => {
    const result = composeSystemPrompt(undefined, baseContext);
    expect(result).not.toContain("## Relevant Memories");
  });

  it("dynamic layers called with correct context object", () => {
    let receivedContext: PromptContext | undefined;
    const config: PromptComposerConfig = {
      dynamicLayers: (ctx) => {
        receivedContext = ctx;
        return [];
      },
    };
    const ctx: PromptContext = {
      tools: [makeTool("search", "Search the web")],
      iteration: 3,
      memories: ["mem1"],
      tokenBudget: 50_000,
    };
    composeSystemPrompt(config, ctx);
    expect(receivedContext).toBeDefined();
    expect(receivedContext!.iteration).toBe(3);
    expect(receivedContext!.tokenBudget).toBe(50_000);
    expect(receivedContext!.tools).toHaveLength(1);
    expect(receivedContext!.memories).toEqual(["mem1"]);
  });

  it("tool descriptions section included when tools provided and non-empty", () => {
    const ctx: PromptContext = {
      ...baseContext,
      tools: [
        makeTool("search", "Search the web"),
        makeTool("calc", "Calculate math expressions"),
      ],
    };
    const result = composeSystemPrompt(undefined, ctx);
    expect(result).toContain("## Available Tools");
    expect(result).toContain("- search: Search the web");
    expect(result).toContain("- calc: Calculate math expressions");
  });

  it("no tool section when tools array is empty", () => {
    const result = composeSystemPrompt(undefined, baseContext);
    expect(result).not.toContain("## Available Tools");
  });

  it("layers with same position and priority maintain insertion order", () => {
    const config: PromptComposerConfig = {
      layers: [
        { id: "first", content: "FIRST_LAYER", position: "append", priority: 5 },
        { id: "second", content: "SECOND_LAYER", position: "append", priority: 5 },
        { id: "third", content: "THIRD_LAYER", position: "append", priority: 5 },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    const firstIdx = result.indexOf("FIRST_LAYER");
    const secondIdx = result.indexOf("SECOND_LAYER");
    const thirdIdx = result.indexOf("THIRD_LAYER");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it("token budget trimming truncates when content exceeds budget", () => {
    const longContent = "A".repeat(10_000);
    const config: PromptComposerConfig = {
      base: longContent,
    };
    const ctx: PromptContext = {
      ...baseContext,
      tokenBudget: 500, // ~2000 chars at 4 chars/token
    };
    const result = composeSystemPrompt(config, ctx);
    expect(result.length).toBeLessThanOrEqual(500 * 4);
  });

  it("replace_base with highest priority wins when multiple replace_base layers exist", () => {
    const config: PromptComposerConfig = {
      layers: [
        { id: "low-replace", content: "Low priority base.", position: "replace_base", priority: 1 },
        { id: "high-replace", content: "High priority base.", position: "replace_base", priority: 10 },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    expect(result).toContain("High priority base.");
    expect(result).not.toContain("Low priority base.");
    expect(result).not.toContain(DEFAULT_BASE_PROMPT);
  });

  it("dynamic layers are merged with static layers", () => {
    const config: PromptComposerConfig = {
      layers: [
        { id: "static", content: "STATIC_LAYER", position: "prepend", priority: 5 },
      ],
      dynamicLayers: () => [
        { id: "dynamic", content: "DYNAMIC_LAYER", position: "prepend", priority: 10 },
      ],
    };
    const result = composeSystemPrompt(config, baseContext);
    expect(result).toContain("STATIC_LAYER");
    expect(result).toContain("DYNAMIC_LAYER");
    // Dynamic layer has higher priority, so it should appear first
    const dynamicIdx = result.indexOf("DYNAMIC_LAYER");
    const staticIdx = result.indexOf("STATIC_LAYER");
    expect(dynamicIdx).toBeLessThan(staticIdx);
  });
});

describe("formatToolDescriptions", () => {
  it("returns empty string for empty tools array", () => {
    expect(formatToolDescriptions([])).toBe("");
  });

  it("formats tools with name and description", () => {
    const tools = [
      makeTool("search", "Search the web"),
      makeTool("calc", "Calculate math"),
    ];
    const result = formatToolDescriptions(tools);
    expect(result).toBe(
      "## Available Tools\n\n- search: Search the web\n- calc: Calculate math",
    );
  });
});

describe("formatMemorySection", () => {
  it("returns empty string for empty memories array", () => {
    expect(formatMemorySection([])).toBe("");
  });

  it("formats memories with header and instructions", () => {
    const result = formatMemorySection(["User likes dark mode."]);
    expect(result).toContain("## Relevant Memories");
    expect(result).toContain("User likes dark mode.");
    expect(result).toContain("Use these memories to inform your decisions.");
  });
});
