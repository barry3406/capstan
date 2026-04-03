import type {
  AgentRunConfig,
  AgentTask,
  AgentTool,
  LLMMessage,
} from "../types.js";

export function buildInitialLoopMessages(
  config: AgentRunConfig,
  availableTools: AgentTool[],
  availableTasks: AgentTask[] = [],
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  if (config.systemPrompt) {
    messages.push({ role: "system", content: config.systemPrompt });
  } else {
    messages.push({
      role: "system",
      content:
        "You are a helpful agent. Use the available tools to accomplish the user's goal. " +
        "When you have completed the goal, respond with a final summary.\n\n" +
        "Available tools:\n" +
        (availableTools.length > 0
          ? availableTools
              .map((tool) => `- ${tool.name}: ${tool.description}`)
              .join("\n")
          : "- (none)") +
        "\n\nAvailable tasks:\n" +
        (availableTasks.length > 0
          ? availableTasks
              .map(
                (task) =>
                  `- ${task.name}${task.kind ? ` [${task.kind}]` : ""}: ${task.description}`,
              )
              .join("\n")
          : "- (none)") +
        "\n\nTo call tools, respond with JSON in one of these formats:\n" +
        '- {"tool": "<name>", "arguments": { ... }}\n' +
        '- {"tools": [{"tool": "<name>", "arguments": { ... }}]}\n' +
        '- [{"tool": "<name>", "arguments": { ... }}]\n' +
        "The same JSON format may target either a tool or a task by name.\n" +
        "To finish, respond with plain text (no JSON tool or task call).",
    });
  }

  messages.push({ role: "user", content: config.goal });
  return messages;
}

export function cloneLoopMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((message) => ({ ...message }));
}

export function parseAgentToolCall(
  content: string,
): { name: string; arguments: Record<string, unknown> } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed != null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "tool" in (parsed as Record<string, unknown>) &&
      "arguments" in (parsed as Record<string, unknown>) &&
      typeof (parsed as Record<string, unknown>).tool === "string" &&
      (parsed as Record<string, unknown>).arguments != null &&
      typeof (parsed as Record<string, unknown>).arguments === "object" &&
      !Array.isArray((parsed as Record<string, unknown>).arguments)
    ) {
      return {
        name: (parsed as Record<string, unknown>).tool as string,
        arguments: (parsed as Record<string, unknown>).arguments as Record<string, unknown>,
      };
    }
  } catch {
    // plain-text response
  }

  return null;
}
