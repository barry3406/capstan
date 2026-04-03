import type {
  AgentLoopCheckpoint,
  AgentLoopControlDecision,
  AgentRunConfig,
  AgentRunResult,
  AgentTool,
  LLMMessage,
  LLMProvider,
} from "./types.js";

/**
 * Run an agent loop: LLM -> tool calls -> results -> repeat until done.
 *
 * The loop is cooperative. It can checkpoint and stop at safe boundaries,
 * but it does not preempt an in-flight model call or tool execution.
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
    /** Resume from a previously persisted checkpoint */
    checkpoint?: AgentLoopCheckpoint;
    /** Resume an already-approved pending tool without re-blocking it once */
    resumePendingTool?: boolean;
    /** Persist and optionally transform the current loop checkpoint at safe boundaries */
    onCheckpoint?: (
      checkpoint: AgentLoopCheckpoint,
    ) => Promise<AgentLoopCheckpoint | void>;
    /** Assemble a call-specific message list without mutating the persisted transcript */
    prepareMessages?: (
      checkpoint: AgentLoopCheckpoint,
    ) => Promise<LLMMessage[] | void>;
    /** Runtime lifecycle control checked at safe boundaries */
    getControlState?: (
      phase: "before_llm" | "before_tool" | "after_tool",
      checkpoint: AgentLoopCheckpoint,
    ) => Promise<AgentLoopControlDecision>;
    /** Back-compat shim for harness runtime control */
    control?: {
      check(): Promise<"continue" | "pause" | "cancel">;
    };
  },
): Promise<AgentRunResult> {
  const maxIterations = config.maxIterations ?? 10;
  const callStack = opts?.callStack ?? new Set<string>();

  // Build available tools, excluding routes in call stack (recursion guard)
  const availableTools = tools.filter((tool) => !callStack.has(tool.name));

  const checkpointConfig: AgentLoopCheckpoint["config"] = {
    goal: config.goal,
    maxIterations,
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
  };

  let messages: LLMMessage[] = opts?.checkpoint
    ? opts.checkpoint.messages.map((message) => ({ ...message }))
    : buildInitialMessages(config, availableTools);

  let toolCalls: AgentRunResult["toolCalls"] = opts?.checkpoint
    ? opts.checkpoint.toolCalls.map((call) => ({ ...call }))
    : [];

  let iterations = opts?.checkpoint?.iterations ?? 0;
  let pendingToolCall = opts?.checkpoint?.pendingToolCall
    ? { ...opts.checkpoint.pendingToolCall }
    : undefined;
  let skipNextPolicyCheck = opts?.resumePendingTool === true && Boolean(pendingToolCall);

  const snapshot = (
    stage: AgentLoopCheckpoint["stage"],
    lastAssistantResponse?: string,
  ): AgentLoopCheckpoint => ({
    stage,
    config: checkpointConfig,
    messages: messages.map((message) => ({ ...message })),
    iterations,
    toolCalls: toolCalls.map((call) => ({ ...call })),
    ...(pendingToolCall ? { pendingToolCall: { ...pendingToolCall } } : {}),
    ...(lastAssistantResponse ? { lastAssistantResponse } : {}),
  });

  const applyCheckpoint = (checkpoint: AgentLoopCheckpoint): void => {
    messages = checkpoint.messages.map((message) => ({ ...message }));
    iterations = checkpoint.iterations;
    toolCalls = checkpoint.toolCalls.map((call) => ({ ...call }));
    pendingToolCall = checkpoint.pendingToolCall
      ? { ...checkpoint.pendingToolCall }
      : undefined;
  };

  const persistCheckpoint = async (
    stage: AgentLoopCheckpoint["stage"],
    lastAssistantResponse?: string,
  ): Promise<AgentLoopCheckpoint> => {
    const checkpoint = snapshot(stage, lastAssistantResponse);
    const nextCheckpoint = opts?.onCheckpoint
      ? (await opts.onCheckpoint(checkpoint)) ?? checkpoint
      : checkpoint;
    applyCheckpoint(nextCheckpoint);
    if (opts?.onCheckpoint) {
      return nextCheckpoint;
    }
    return nextCheckpoint;
  };

  const evaluateControl = async (
    phase: "before_llm" | "before_tool" | "after_tool",
  ): Promise<AgentRunResult | undefined> => {
    if (!opts?.getControlState && !opts?.control) {
      return undefined;
    }

    const checkpoint = await persistCheckpoint(
      phase === "before_llm"
        ? "initialized"
        : phase === "after_tool"
          ? "tool_result"
          : "assistant_response",
    );
    const decision = opts.getControlState
      ? await opts.getControlState(phase, checkpoint)
      : opts.control
        ? { action: await opts.control.check() }
        : { action: "continue" as const };

    if (decision.action === "pause") {
      return {
        result: null,
        iterations,
        toolCalls,
        status: "paused",
        checkpoint,
      };
    }

    if (decision.action === "cancel") {
      const canceledCheckpoint = await persistCheckpoint("canceled");
      return {
        result: decision.reason ?? null,
        iterations,
        toolCalls,
        status: "canceled",
        checkpoint: canceledCheckpoint,
      };
    }

    return undefined;
  };

  await persistCheckpoint("initialized");

  while (pendingToolCall || iterations < maxIterations) {
    if (!pendingToolCall) {
      const controlled = await evaluateControl("before_llm");
      if (controlled) {
        return controlled;
      }

      const llmCheckpoint = snapshot("initialized");
      const callMessages =
        (await opts?.prepareMessages?.(llmCheckpoint))?.map((message) => ({ ...message })) ??
        messages.map((message) => ({ ...message }));

      iterations++;

      const response = await llm.chat(callMessages);
      const content = response.content;
      const parsed = tryParseToolCall(content);

      if (!parsed) {
        messages.push({ role: "assistant", content });
        const checkpoint = await persistCheckpoint("completed", content);
        return {
          result: content,
          iterations,
          toolCalls,
          status: "completed",
          checkpoint,
        };
      }

      pendingToolCall = {
        assistantMessage: content,
        tool: parsed.name,
        args: parsed.arguments,
      };
      await persistCheckpoint("assistant_response", content);
    }

    const toolCall = pendingToolCall;
    if (!toolCall) {
      continue;
    }

    const tool = availableTools.find((entry) => entry.name === toolCall.tool);
    if (!tool) {
      messages.push({ role: "assistant", content: toolCall.assistantMessage });
      messages.push({
        role: "user",
        content: `Error: Tool "${toolCall.tool}" not found. Available tools: ${availableTools.map((entry) => entry.name).join(", ")}`,
      });
      pendingToolCall = undefined;
      await persistCheckpoint("tool_result");
      continue;
    }

    const controlled = await evaluateControl("before_tool");
    if (controlled) {
      return controlled;
    }

    if (opts?.beforeToolCall && !skipNextPolicyCheck) {
      const check = await opts.beforeToolCall(toolCall.tool, toolCall.args);
      if (!check.allowed) {
        const checkpoint = await persistCheckpoint(
          "approval_required",
          toolCall.assistantMessage,
        );
        return {
          result: null,
          iterations,
          toolCalls,
          status: "approval_required",
          pendingApproval: {
            tool: toolCall.tool,
            args: toolCall.args,
            reason: check.reason ?? "Tool call blocked by policy",
          },
          checkpoint,
        };
      }
    }
    skipNextPolicyCheck = false;

    let toolResult: unknown;
    try {
      toolResult = await tool.execute(toolCall.args);
    } catch (error) {
      toolResult = { error: error instanceof Error ? error.message : String(error) };
    }

    toolCalls.push({ tool: toolCall.tool, args: toolCall.args, result: toolResult });

    if (opts?.afterToolCall) {
      await opts.afterToolCall(toolCall.tool, toolCall.args, toolResult);
    }

    if (opts?.onMemoryEvent) {
      await opts.onMemoryEvent(
        `Tool ${toolCall.tool} called with ${JSON.stringify(toolCall.args)} => ${JSON.stringify(toolResult)}`,
      );
    }

    messages.push({ role: "assistant", content: toolCall.assistantMessage });
    messages.push({
      role: "user",
      content: `Tool "${toolCall.tool}" returned:\n${JSON.stringify(toolResult, null, 2)}`,
    });
    pendingToolCall = undefined;

    const postToolControl = await evaluateControl("after_tool");
    if (postToolControl) {
      return postToolControl;
    }

    await persistCheckpoint("tool_result");
  }

  const checkpoint = await persistCheckpoint("max_iterations");
  return {
    result: messages[messages.length - 1]?.content ?? null,
    iterations,
    toolCalls,
    status: "max_iterations",
    checkpoint,
  };
}

function buildInitialMessages(
  config: AgentRunConfig,
  availableTools: AgentTool[],
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
        availableTools
          .map((tool) => `- ${tool.name}: ${tool.description}`)
          .join("\n") +
        "\n\nTo call a tool, respond with JSON: {\"tool\": \"<name>\", \"arguments\": {…}}\n" +
        "To finish, respond with plain text (no JSON tool call).",
    });
  }

  messages.push({ role: "user", content: config.goal });

  return messages;
}

function tryParseToolCall(
  content: string,
): { name: string; arguments: Record<string, unknown> } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "tool" in (parsed as Record<string, unknown>) &&
      "arguments" in (parsed as Record<string, unknown>)
    ) {
      return {
        name: (parsed as Record<string, unknown>).tool as string,
        arguments: (parsed as Record<string, unknown>).arguments as Record<string, unknown>,
      };
    }
  } catch {
    // Final plain-text response.
  }

  return null;
}
