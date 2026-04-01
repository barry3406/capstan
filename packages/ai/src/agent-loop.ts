import type { LLMProvider, LLMMessage, AgentTool, AgentRunConfig, AgentRunResult } from "./types.js";

/**
 * Run an agent loop: LLM -> tool calls -> results -> repeat until done.
 *
 * Design principles (from pi-mono):
 * - The LLM decides what to do, the loop just executes
 * - Tools are the agent's "hands", the LLM is the "brain"
 * - Stop when LLM responds without tool calls or maxIterations hit
 */
export async function runAgentLoop(
  llm: LLMProvider,
  config: AgentRunConfig,
  tools: AgentTool[],
  opts?: {
    /** Called before each tool execution. Return false to block (approval). */
    beforeToolCall?: (tool: string, args: unknown) => Promise<{ allowed: boolean; reason?: string }>;
    /** Called after each tool execution */
    afterToolCall?: (tool: string, args: unknown, result: unknown) => Promise<void>;
    /** Routes currently in the call stack (for recursion prevention) */
    callStack?: Set<string>;
    /** Called when a memory-worthy event happens during the loop */
    onMemoryEvent?: (content: string) => Promise<void>;
  },
): Promise<AgentRunResult> {
  const maxIterations = config.maxIterations ?? 10;
  const callStack = opts?.callStack ?? new Set<string>();
  const toolCalls: AgentRunResult["toolCalls"] = [];

  // Build available tools, excluding routes in call stack (recursion guard)
  const availableTools = tools.filter(t => !callStack.has(t.name));

  // Build messages
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
        availableTools
          .map(t => `- ${t.name}: ${t.description}`)
          .join("\n") +
        "\n\nTo call a tool, respond with JSON: {\"tool\": \"<name>\", \"arguments\": {…}}\n" +
        "To finish, respond with plain text (no JSON tool call).",
    });
  }
  messages.push({ role: "user", content: config.goal });

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Call LLM
    const response = await llm.chat(messages);

    const content = response.content;

    // Try to parse as JSON tool call
    let toolCall: { name: string; arguments: Record<string, unknown> } | null = null;
    try {
      const parsed: unknown = JSON.parse(content);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "tool" in (parsed as Record<string, unknown>) &&
        "arguments" in (parsed as Record<string, unknown>)
      ) {
        toolCall = {
          name: (parsed as Record<string, unknown>).tool as string,
          arguments: (parsed as Record<string, unknown>).arguments as Record<string, unknown>,
        };
      }
    } catch {
      // Not a tool call -- this is the final response
    }

    if (!toolCall) {
      // No tool call -- agent is done
      return {
        result: content,
        iterations,
        toolCalls,
        status: "completed",
      };
    }

    // Find the tool
    const tool = availableTools.find(t => t.name === toolCall!.name);
    if (!tool) {
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Error: Tool "${toolCall.name}" not found. Available tools: ${availableTools.map(t => t.name).join(", ")}`,
      });
      continue;
    }

    // Check beforeToolCall (policy / approval bridge)
    if (opts?.beforeToolCall) {
      const check = await opts.beforeToolCall(toolCall.name, toolCall.arguments);
      if (!check.allowed) {
        return {
          result: null,
          iterations,
          toolCalls,
          status: "approval_required",
          pendingApproval: {
            tool: toolCall.name,
            args: toolCall.arguments,
            reason: check.reason ?? "Tool call blocked by policy",
          },
        };
      }
    }

    // Execute tool
    let toolResult: unknown;
    try {
      toolResult = await tool.execute(toolCall.arguments);
    } catch (err) {
      toolResult = { error: err instanceof Error ? err.message : String(err) };
    }

    toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: toolResult });

    // afterToolCall hook
    if (opts?.afterToolCall) {
      await opts.afterToolCall(toolCall.name, toolCall.arguments, toolResult);
    }

    // Emit memory event if hook provided
    if (opts?.onMemoryEvent) {
      await opts.onMemoryEvent(
        `Tool ${toolCall.name} called with ${JSON.stringify(toolCall.arguments)} => ${JSON.stringify(toolResult)}`,
      );
    }

    // Feed result back to LLM
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: `Tool "${toolCall.name}" returned:\n${JSON.stringify(toolResult, null, 2)}`,
    });
  }

  // Max iterations reached
  return {
    result: messages[messages.length - 1]?.content ?? null,
    iterations,
    toolCalls,
    status: "max_iterations",
  };
}
