import type { AgentTool, ToolCatalogConfig } from "../types.js";

// Claude Code-style agents routinely carry 30-50 tools. Deferring anything
// above 15 pushed the LLM into a "discover_tools" loop that wasted iterations.
// Keep it inline up to 64 so the full parameter schema lands in the prompt
// on first turn and the LLM can act immediately.
const DEFAULT_DEFER_THRESHOLD = 64;

export interface ToolCatalogResult {
  mode: "inline" | "deferred";
  promptSection: string;
  discoverTool?: AgentTool | undefined;
}

export function createToolCatalog(
  tools: AgentTool[],
  config?: ToolCatalogConfig,
): ToolCatalogResult {
  const threshold = config?.deferThreshold ?? DEFAULT_DEFER_THRESHOLD;

  if (tools.length <= threshold) {
    return {
      mode: "inline",
      promptSection: formatInlineToolDescriptions(tools),
    };
  }

  const discoverTool: AgentTool = {
    name: "discover_tools",
    description:
      "Search for available tools by keyword. Returns matching tool names and descriptions. Use this before calling a tool you haven't seen yet.",
    isConcurrencySafe: true,
    async execute(args) {
      const query = ((args.query as string) ?? "").toLowerCase();
      if (!query) {
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
      }
      const matches = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query),
      );
      return matches.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    },
  };

  return {
    mode: "deferred",
    promptSection: `You have ${tools.length} tools available. Use the "discover_tools" tool to find the right tool for each task.`,
    discoverTool,
  };
}

function formatInlineToolDescriptions(tools: AgentTool[]): string {
  if (tools.length === 0) return "No tools available.";
  return (
    "Available tools:\n" +
    tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
  );
}
