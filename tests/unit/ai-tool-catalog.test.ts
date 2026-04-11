import { describe, expect, it } from "bun:test";

import type { AgentTool, ToolCatalogConfig } from "../../packages/ai/src/types.ts";
import {
  createToolCatalog,
  type ToolCatalogResult,
} from "../../packages/ai/src/loop/tool-catalog.ts";

function makeTool(name: string, description = `Tool ${name}`): AgentTool {
  return {
    name,
    description,
    async execute() {
      return { ok: true };
    },
  };
}

function makeTools(count: number): AgentTool[] {
  return Array.from({ length: count }, (_, i) => makeTool(`tool_${i + 1}`));
}

describe("createToolCatalog", () => {
  it("uses inline mode when tools.length <= default threshold (15)", () => {
    const tools = makeTools(15);
    const result = createToolCatalog(tools);
    expect(result.mode).toBe("inline");
    expect(result.discoverTool).toBeUndefined();
  });

  it("uses deferred mode when tools.length > default threshold (15)", () => {
    const tools = makeTools(16);
    const result = createToolCatalog(tools);
    expect(result.mode).toBe("deferred");
    expect(result.discoverTool).toBeDefined();
  });

  it("inline promptSection lists all tool names and descriptions", () => {
    const tools = [
      makeTool("read_file", "Read a file from disk"),
      makeTool("write_file", "Write content to a file"),
    ];
    const result = createToolCatalog(tools);
    expect(result.mode).toBe("inline");
    expect(result.promptSection).toContain("read_file");
    expect(result.promptSection).toContain("Read a file from disk");
    expect(result.promptSection).toContain("write_file");
    expect(result.promptSection).toContain("Write content to a file");
  });

  it("deferred promptSection shows tool count message", () => {
    const tools = makeTools(20);
    const result = createToolCatalog(tools);
    expect(result.mode).toBe("deferred");
    expect(result.promptSection).toContain("20");
    expect(result.promptSection).toContain("discover_tools");
  });

  it("discover_tools meta-tool returns matching tools by name keyword (case-insensitive)", async () => {
    const tools = [
      makeTool("read_file", "Read a file"),
      makeTool("write_file", "Write a file"),
      makeTool("list_dir", "List directory contents"),
    ];
    const result = createToolCatalog(tools, { deferThreshold: 1 });
    expect(result.discoverTool).toBeDefined();

    const matches = await result.discoverTool!.execute({ query: "READ" }) as Array<{ name: string }>;
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("read_file");
  });

  it("discover_tools meta-tool returns matching tools by description keyword", async () => {
    const tools = [
      makeTool("tool_a", "Manage database connections"),
      makeTool("tool_b", "Send HTTP requests"),
      makeTool("tool_c", "Parse database schemas"),
    ];
    const result = createToolCatalog(tools, { deferThreshold: 1 });

    const matches = await result.discoverTool!.execute({ query: "database" }) as Array<{ name: string }>;
    expect(matches).toHaveLength(2);
    const names = matches.map((m) => m.name);
    expect(names).toContain("tool_a");
    expect(names).toContain("tool_c");
  });

  it("discover_tools returns empty array for no matches", async () => {
    const tools = makeTools(5);
    const result = createToolCatalog(tools, { deferThreshold: 1 });

    const matches = await result.discoverTool!.execute({ query: "nonexistent_xyz" }) as unknown[];
    expect(matches).toHaveLength(0);
  });

  it("discover_tools is marked isConcurrencySafe=true", () => {
    const tools = makeTools(20);
    const result = createToolCatalog(tools);
    expect(result.discoverTool).toBeDefined();
    expect(result.discoverTool!.isConcurrencySafe).toBe(true);
  });

  it("all original tools remain accessible (not removed from tools map)", () => {
    const tools = makeTools(20);
    const originalNames = tools.map((t) => t.name);
    createToolCatalog(tools);
    const afterNames = tools.map((t) => t.name);
    expect(afterNames).toEqual(originalNames);
    expect(tools).toHaveLength(20);
  });

  it("custom threshold works (e.g., threshold=2)", () => {
    const tools = makeTools(3);
    const config: ToolCatalogConfig = { deferThreshold: 2 };

    const result = createToolCatalog(tools, config);
    expect(result.mode).toBe("deferred");
    expect(result.discoverTool).toBeDefined();

    const inlineResult = createToolCatalog(makeTools(2), config);
    expect(inlineResult.mode).toBe("inline");
    expect(inlineResult.discoverTool).toBeUndefined();
  });
});
