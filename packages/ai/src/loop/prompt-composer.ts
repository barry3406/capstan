import type {
  PromptComposerConfig,
  PromptContext,
  PromptLayer,
  AgentTool,
} from "../types.js";

const DEFAULT_BASE_PROMPT = `You are an autonomous agent. Accomplish the user's goal using the available tools. When finished, respond with a final summary in plain text.

To call tools, respond with JSON:
{"tool": "<name>", "arguments": { ... }}

For multiple concurrent calls:
[{"tool": "<name>", "arguments": { ... }}, ...]

To finish, respond with plain text (no JSON tool call).`;

export { DEFAULT_BASE_PROMPT };

/**
 * Compose a complete system prompt from config, layers, tools, and memories.
 *
 * Assembly order:
 *   [...prepend layers (sorted by priority desc)] + base + tool section + memory section + [...append layers (sorted by priority desc)]
 *
 * If any layer has position "replace_base", the highest-priority one replaces
 * the configured (or default) base entirely.
 *
 * When the assembled prompt exceeds `tokenBudget * 4` characters it is
 * truncated from the end.
 */
export function composeSystemPrompt(
  config: PromptComposerConfig | undefined,
  context: PromptContext,
): string {
  // 1. Determine base prompt
  let base = config?.base ?? DEFAULT_BASE_PROMPT;

  // 2. Collect all layers: static + dynamic
  const staticLayers = config?.layers ?? [];
  const dynamicLayers = config?.dynamicLayers?.(context) ?? [];
  const allLayers: PromptLayer[] = [...staticLayers, ...dynamicLayers];

  // 3. Check for replace_base layers — use highest-priority one
  const replaceLayers = allLayers.filter((l) => l.position === "replace_base");
  if (replaceLayers.length > 0) {
    replaceLayers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    base = replaceLayers[0]!.content;
  }

  // 4. Separate remaining layers into prepend and append groups
  const remaining = allLayers.filter((l) => l.position !== "replace_base");
  const prependLayers = remaining.filter((l) => l.position === "prepend");
  const appendLayers = remaining.filter((l) => l.position === "append");

  // 5. Sort each group by priority descending; stable sort preserves insertion order for equal priorities
  prependLayers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  appendLayers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // 6. Build sections
  const sections: string[] = [];

  for (const layer of prependLayers) {
    sections.push(layer.content);
  }

  sections.push(base);

  const toolSection = formatToolDescriptions(context.tools);
  if (toolSection) {
    sections.push(toolSection);
  }

  const memorySection = formatMemorySection(context.memories);
  if (memorySection) {
    sections.push(memorySection);
  }

  for (const layer of appendLayers) {
    sections.push(layer.content);
  }

  // 7. Join with double newlines
  let result = sections.join("\n\n");

  // 8. Token budget trimming (approximate: 1 token ~ 4 chars)
  const charBudget = context.tokenBudget * 4;
  if (result.length > charBudget) {
    result = result.slice(0, charBudget);
  }

  return result;
}

/**
 * Format tool descriptions into a markdown section.
 * Returns empty string when no tools are provided.
 */
export function formatToolDescriptions(tools: AgentTool[]): string {
  if (tools.length === 0) return "";
  return (
    "## Available Tools\n\n" +
    tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
  );
}

/**
 * Format memory entries into a markdown section with usage instructions.
 * Returns empty string when no memories are provided.
 */
export function formatMemorySection(memories: string[]): string {
  if (memories.length === 0) return "";
  return (
    "## Relevant Memories\n\nThe following are observations from your past experience that may be relevant to the current task:\n\n" +
    memories.join("\n") +
    "\n\nUse these memories to inform your decisions. Do not mention them explicitly unless asked."
  );
}
