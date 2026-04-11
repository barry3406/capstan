import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentTool } from "../../../../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Smoke-layer tools (pure computation / fake data)
// ---------------------------------------------------------------------------

export const multiplyTool: AgentTool = {
  name: "multiply",
  description: "Multiplies two numbers and returns the product.",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  },
  async execute(args) {
    return (args.a as number) * (args.b as number);
  },
};

export const addTool: AgentTool = {
  name: "add",
  description: "Adds two numbers and returns the sum.",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  },
  async execute(args) {
    return (args.a as number) + (args.b as number);
  },
};

export const getWeatherTool: AgentTool = {
  name: "get_weather",
  description: "Gets current weather for a city. Returns temperature and conditions.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  async execute(args) {
    const city = args.city as string;
    return { city, temperature: 22, unit: "celsius", conditions: "partly cloudy" };
  },
};

export const searchDatabaseTool: AgentTool = {
  name: "search_database",
  description: "Searches a database by keyword. Returns matching records.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  async execute(args) {
    return { query: args.query, results: [{ id: 1, title: `Result for "${args.query}"` }], total: 1 };
  },
};

export const formatTextTool: AgentTool = {
  name: "format_text",
  description: "Formats text in a given style: uppercase, lowercase, or titlecase.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string" },
      style: { type: "string", enum: ["uppercase", "lowercase", "titlecase"] },
    },
    required: ["text", "style"],
  },
  async execute(args) {
    const text = args.text as string;
    const style = args.style as string;
    if (style === "uppercase") return text.toUpperCase();
    if (style === "lowercase") return text.toLowerCase();
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  },
};

// ---------------------------------------------------------------------------
// Scenario-layer tools (real filesystem + shell)
// ---------------------------------------------------------------------------

export function createReadFileTool(workspaceDir: string): AgentTool {
  return {
    name: "read_file",
    description: "Read the contents of a file in the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path within the workspace" } },
      required: ["path"],
    },
    async execute(args) {
      const target = resolve(workspaceDir, args.path as string);
      if (!target.startsWith(workspaceDir)) return { error: "Path outside workspace" };
      if (!existsSync(target)) return { error: `File not found: ${args.path}` };
      return readFileSync(target, "utf-8");
    },
  };
}

export function createWriteFileTool(workspaceDir: string): AgentTool {
  return {
    name: "write_file",
    description: "Write content to a file in the workspace. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within the workspace" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
    async execute(args) {
      const target = resolve(workspaceDir, args.path as string);
      if (!target.startsWith(workspaceDir)) return { error: "Path outside workspace" };
      const dir = join(target, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(target, args.content as string, "utf-8");
      return "ok";
    },
  };
}

export function createListFilesTool(workspaceDir: string): AgentTool {
  return {
    name: "list_files",
    description: "List files and directories in a workspace directory.",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Relative directory path (default: root of workspace)" },
      },
    },
    async execute(args) {
      const target = resolve(workspaceDir, (args.dir as string) ?? ".");
      if (!target.startsWith(workspaceDir)) return { error: "Path outside workspace" };
      if (!existsSync(target)) return { error: `Directory not found: ${args.dir ?? "."}` };
      const entries = readdirSync(target, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
    },
  };
}

export function createRunCommandTool(workspaceDir: string): AgentTool {
  return {
    name: "run_command",
    description: "Run a shell command in the workspace directory. Use for running tests (bun test), checking output, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
    async execute(args) {
      const cmd = args.command as string;
      const result = spawnSync("sh", ["-c", cmd], {
        cwd: workspaceDir,
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env },
      });
      return {
        exitCode: result.status ?? 1,
        stdout: (result.stdout ?? "").slice(0, 5000),
        stderr: (result.stderr ?? "").slice(0, 2000),
      };
    },
  };
}

/** Bundle all filesystem + shell tools for a workspace. */
export function createWorkspaceTools(workspaceDir: string): AgentTool[] {
  return [
    createReadFileTool(workspaceDir),
    createWriteFileTool(workspaceDir),
    createListFilesTool(workspaceDir),
    createRunCommandTool(workspaceDir),
  ];
}
