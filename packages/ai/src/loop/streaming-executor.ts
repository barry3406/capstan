import type {
  AgentTool,
  AgentToolCallRecord,
  LLMProvider,
  LLMMessage,
  LLMOptions,
  ToolRequest,
  ModelFinishReason,
  SmartAgentHooks,
  StreamingExecutorConfig,
} from "../types.js";
import { validateArgs } from "./validate-args.js";

// ---------------------------------------------------------------------------
// Tool call parsing (migrated from sampler.ts)
// ---------------------------------------------------------------------------

export function parseToolRequests(content: string): ToolRequest[] {
  const candidates = [content, ...extractFencedJson(content)];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed === undefined) {
      continue;
    }
    const requests = normalizeToolRequests(parsed);
    if (requests.length > 0) {
      return requests;
    }
  }
  return [];
}

function normalizeToolRequests(value: unknown): ToolRequest[] {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeSingleToolRequest(entry, index))
      .filter((entry): entry is ToolRequest => entry != null);
  }

  if (isPlainObject(value) && Array.isArray(value.tools)) {
    return value.tools
      .map((entry, index) => normalizeSingleToolRequest(entry, index))
      .filter((entry): entry is ToolRequest => entry != null);
  }

  const single = normalizeSingleToolRequest(value, 0);
  return single ? [single] : [];
}

function normalizeSingleToolRequest(
  value: unknown,
  index: number,
): ToolRequest | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const name = typeof value.tool === "string" ? value.tool.trim() : "";
  const argsCandidate = isPlainObject(value.arguments)
    ? value.arguments
    : isPlainObject(value.args)
      ? value.args
      : undefined;
  if (!name || !argsCandidate) {
    return undefined;
  }

  return {
    id: `toolreq_${index}_${crypto.randomUUID()}`,
    name,
    args: cloneArgs(argsCandidate),
    order: index,
  };
}

function tryParseJson(content: string): unknown | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function extractFencedJson(content: string): string[] {
  const blocks = content.match(/```json\s*([\s\S]*?)```/gi) ?? [];
  return blocks
    .map((block) => block.replace(/^```json\s*/i, "").replace(/```$/i, "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Finish reason normalization
// ---------------------------------------------------------------------------

export function normalizeFinishReason(
  reason: string | undefined,
  hasTools: boolean,
): ModelFinishReason {
  const normalized = reason?.trim().toLowerCase();
  if (hasTools || normalized === "tool_use" || normalized === "tool") {
    return "tool_use";
  }
  if (
    normalized === "max_output_tokens" ||
    normalized === "max_tokens" ||
    normalized === "length"
  ) {
    return "max_output_tokens";
  }
  if (
    normalized === "context_limit" ||
    normalized === "prompt_too_long" ||
    normalized === "context_window_exceeded"
  ) {
    return "context_limit";
  }
  if (normalized === "error") {
    return "error";
  }
  return "stop";
}

// ---------------------------------------------------------------------------
// Model outcome
// ---------------------------------------------------------------------------

export interface ModelOutcome {
  content: string;
  toolRequests: ToolRequest[];
  finishReason: ModelFinishReason;
  hasToolErrors?: boolean | undefined;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ---------------------------------------------------------------------------
// Single-tool execution helper (shared by concurrent & serial paths)
// ---------------------------------------------------------------------------

type SingleToolResult =
  | { kind: "executed"; record: AgentToolCallRecord; hardFailure: boolean }
  | { kind: "blocked"; approval: { kind: "tool"; tool: string; args: unknown; reason: string } };

async function executeSingleTool(
  request: ToolRequest,
  tool: AgentTool,
  hooks: SmartAgentHooks | undefined,
): Promise<SingleToolResult> {
  // Policy check via hook
  if (hooks?.beforeToolCall) {
    const policy = await hooks.beforeToolCall(request.name, request.args);
    if (!policy.allowed) {
      return {
        kind: "blocked",
        approval: {
          kind: "tool",
          tool: request.name,
          args: request.args,
          reason: policy.reason ?? "Blocked by policy",
        },
      };
    }
  }

  // Input validation
  if (tool.validate) {
    const validation = tool.validate(cloneArgs(request.args));
    if (!validation.valid) {
      return {
        kind: "executed",
        record: { tool: request.name, args: request.args, result: { error: `Input validation failed:\n${validation.error}` }, requestId: request.id, order: request.order, status: "error" },
        hardFailure: false,
      };
    }
  } else if (tool.parameters) {
    const validation = validateArgs(request.args, tool.parameters);
    if (!validation.valid) {
      return {
        kind: "executed",
        record: { tool: request.name, args: request.args, result: { error: `Tool "${request.name}" input validation failed:\n${validation.error}` }, requestId: request.id, order: request.order, status: "error" },
        hardFailure: false,
      };
    }
  }

  // Execute tool (with optional timeout)
  let result: unknown;
  let status: "success" | "error" = "success";
  let hardFailure = false;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    if (tool.timeout) {
      try {
        result = await Promise.race([
          tool.execute(cloneArgs(request.args)),
          new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error(
              `Tool "${request.name}" timed out after ${tool.timeout}ms`
            )), tool.timeout!);
          }),
        ]);
      } finally {
        if (timerId) clearTimeout(timerId);
      }
    } else {
      result = await tool.execute(cloneArgs(request.args));
    }
  } catch (error) {
    status = "error";
    result = {
      error: error instanceof Error ? error.message : String(error),
    };
    if (tool.failureMode === "hard") {
      hardFailure = true;
    }
  }

  const record: AgentToolCallRecord = {
    tool: request.name,
    args: request.args,
    result,
    requestId: request.id,
    order: request.order,
    status,
  };

  // After-tool hook
  if (hooks?.afterToolCall) {
    await hooks.afterToolCall(request.name, request.args, result, status);
  }

  return { kind: "executed", record, hardFailure };
}

/** Execute a tool without running beforeToolCall or afterToolCall (caller handles hooks) */
async function executeToolCore(
  request: ToolRequest,
  tool: AgentTool,
): Promise<SingleToolResult> {
  // Input validation
  if (tool.validate) {
    const validation = tool.validate(cloneArgs(request.args));
    if (!validation.valid) {
      return {
        kind: "executed",
        record: { tool: request.name, args: request.args, result: { error: `Input validation failed:\n${validation.error}` }, requestId: request.id, order: request.order, status: "error" },
        hardFailure: false,
      };
    }
  } else if (tool.parameters) {
    const validation = validateArgs(request.args, tool.parameters);
    if (!validation.valid) {
      return {
        kind: "executed",
        record: { tool: request.name, args: request.args, result: { error: `Tool "${request.name}" input validation failed:\n${validation.error}` }, requestId: request.id, order: request.order, status: "error" },
        hardFailure: false,
      };
    }
  }

  let result: unknown;
  let status: "success" | "error" = "success";
  let hardFailure = false;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    if (tool.timeout) {
      try {
        result = await Promise.race([
          tool.execute(cloneArgs(request.args)),
          new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error(
              `Tool "${request.name}" timed out after ${tool.timeout}ms`
            )), tool.timeout!);
          }),
        ]);
      } finally {
        if (timerId) clearTimeout(timerId);
      }
    } else {
      result = await tool.execute(cloneArgs(request.args));
    }
  } catch (error) {
    status = "error";
    result = {
      error: error instanceof Error ? error.message : String(error),
    };
    if (tool.failureMode === "hard") {
      hardFailure = true;
    }
  }

  const record: AgentToolCallRecord = {
    tool: request.name,
    args: request.args,
    result,
    requestId: request.id,
    order: request.order,
    status,
  };

  return { kind: "executed", record, hardFailure };
}

// ---------------------------------------------------------------------------
// Concurrency-limited dispatcher
// ---------------------------------------------------------------------------

interface ConcurrentDispatcher {
  dispatch(fn: () => Promise<void>): Promise<void>;
  waitAll(): Promise<void>;
}

function createConcurrentDispatcher(maxConcurrency: number): ConcurrentDispatcher {
  const inFlight = new Set<Promise<void>>();
  let firstError: unknown;

  async function dispatch(fn: () => Promise<void>): Promise<void> {
    // Wait until we have a slot
    while (inFlight.size >= maxConcurrency) {
      await Promise.race(inFlight).catch(() => {});
    }

    const p = fn().catch((err) => {
      if (firstError === undefined) firstError = err;
    }).finally(() => {
      inFlight.delete(p);
    });
    inFlight.add(p);
  }

  async function waitAll(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
    if (firstError !== undefined) {
      const err = firstError;
      firstError = undefined;
      throw err;
    }
  }

  return { dispatch, waitAll };
}

// ---------------------------------------------------------------------------
// Main function — model sampling + tool execution
// ---------------------------------------------------------------------------

export async function executeModelAndTools(
  llm: LLMProvider,
  messages: LLMMessage[],
  tools: AgentTool[],
  hooks: SmartAgentHooks | undefined,
  _config: StreamingExecutorConfig | undefined,
  llmOptions?: LLMOptions,
  llmTimeout?: import("../types.js").LLMTimeoutConfig,
): Promise<{
  outcome: ModelOutcome;
  toolRecords: AgentToolCallRecord[];
  blockedApproval?: { kind: "tool"; tool: string; args: unknown; reason: string };
  haltedByHardFailure: boolean;
}> {
  const maxConcurrency = Math.max(1, _config?.maxConcurrency ?? 10);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // =========================================================================
  // Streaming path — detect and dispatch concurrent-safe tools during stream
  // =========================================================================
  if (llm.stream) {
    let content = "";
    let finishReason: string | undefined;

    // Track dispatched tool request ids so we only dispatch each once
    const dispatchedIds = new Set<string>();

    // Concurrent results collector: order -> record
    const concurrentResults: Map<number, AgentToolCallRecord> = new Map();
    let hardFailureDetected = false;
    let blockedApproval:
      | { kind: "tool"; tool: string; args: unknown; reason: string }
      | undefined;

    // Queued write (non-concurrent-safe) requests for post-stream execution
    const writeQueue: { request: ToolRequest; tool: AgentTool }[] = [];

    // All tool requests accumulated during the stream (for final outcome)
    let allToolRequests: ToolRequest[] = [];

    const dispatcher = createConcurrentDispatcher(maxConcurrency);

    const idleTimeout = llmTimeout?.streamIdleTimeoutMs ?? 90_000;
    let lastChunkTime = Date.now();

    for await (const chunk of llm.stream(messages, llmOptions)) {
      const gap = Date.now() - lastChunkTime;
      if (gap > idleTimeout) {
        throw new Error(`LLM stream idle timeout: no data for ${gap}ms`);
      }
      lastChunkTime = Date.now();

      content += chunk.content;

      if (chunk.done) {
        finishReason = chunk.finishReason;
      }

      // Try to detect complete tool calls from accumulated content
      const detected = parseToolRequests(content);
      if (detected.length > 0) {
        for (const req of detected) {
          const stableKey = `pos_${req.order}`;
          if (dispatchedIds.has(stableKey)) {
            continue;
          }
          // Use the parsed request as-is; dedup is by position key, not by id
          dispatchedIds.add(stableKey);

          const stableReq: ToolRequest = { ...req };

          // Update the master list
          allToolRequests.push(stableReq);

          const tool = toolMap.get(stableReq.name);
          if (!tool) {
            concurrentResults.set(stableReq.order, {
              tool: stableReq.name,
              args: stableReq.args,
              result: { error: `Tool "${stableReq.name}" not found` },
              requestId: stableReq.id,
              order: stableReq.order,
              status: "error",
            });
            continue;
          }

          if (tool.isConcurrencySafe) {
            // Dispatch immediately during streaming
            dispatcher.dispatch(async () => {
              if (blockedApproval || hardFailureDetected) return;
              const result = await executeSingleTool(
                stableReq,
                tool,
                hooks,
              );
              if (result.kind === "blocked") {
                blockedApproval = result.approval;
                return;
              }
              concurrentResults.set(stableReq.order, result.record);
              if (result.hardFailure) {
                hardFailureDetected = true;
              }
            });
          } else {
            // Queue for serial execution after stream ends
            writeQueue.push({ request: stableReq, tool });
          }
        }
      }
    }

    // Wait for all in-flight concurrent tools to finish
    await dispatcher.waitAll();

    // Re-parse final content for the outcome (single canonical parse)
    const finalToolRequests = parseToolRequests(content);

    // Check if we missed any tool calls that only became parseable at the end
    for (const req of finalToolRequests) {
      const stableKey = `pos_${req.order}`;
      if (dispatchedIds.has(stableKey)) {
        continue;
      }
      dispatchedIds.add(stableKey);
      allToolRequests.push(req);

      const tool = toolMap.get(req.name);
      if (!tool) {
        concurrentResults.set(req.order, {
          tool: req.name,
          args: req.args,
          result: { error: `Tool "${req.name}" not found` },
          requestId: req.id,
          order: req.order,
          status: "error",
        });
        continue;
      }

      if (tool.isConcurrencySafe) {
        if (!blockedApproval && !hardFailureDetected) {
          const result = await executeSingleTool(req, tool, hooks);
          if (result.kind === "blocked") {
            blockedApproval = result.approval;
          } else {
            concurrentResults.set(req.order, result.record);
            if (result.hardFailure) hardFailureDetected = true;
          }
        }
      } else {
        writeQueue.push({ request: req, tool });
      }
    }

    // Build outcome using the final parse
    const normalizedFinish = normalizeFinishReason(
      finishReason,
      allToolRequests.length > 0,
    );
    const outcome: ModelOutcome = {
      content,
      toolRequests: allToolRequests,
      finishReason: normalizedFinish,
    };

    // If blocked by approval, return immediately with collected records
    if (blockedApproval) {
      const records = [...concurrentResults.values()].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      return { outcome, toolRecords: records, blockedApproval, haltedByHardFailure: hardFailureDetected };
    }

    // Execute queued write tools serially (only if no hard failure yet)
    if (!hardFailureDetected) {
      for (const { request, tool } of writeQueue) {
        if (hardFailureDetected) break;

        const result = await executeSingleTool(
          request,
          tool,
          hooks,
        );
        if (result.kind === "blocked") {
          blockedApproval = result.approval;
          const records = [...concurrentResults.values()].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0),
          );
          return { outcome, toolRecords: records, blockedApproval, haltedByHardFailure: hardFailureDetected };
        }
        concurrentResults.set(request.order, result.record);
        if (result.hardFailure) {
          hardFailureDetected = true;
        }
      }
    }

    // Sort all records by order
    const sortedRecords = [...concurrentResults.values()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    // Synthetic tool_result for interrupted tools (only when NOT halted by hard failure —
    // hard failure intentionally stops remaining tools, they should NOT get records)
    if (!hardFailureDetected) {
      for (const req of allToolRequests) {
        const hasRecord = sortedRecords.some(r => r.requestId === req.id);
        if (!hasRecord) {
          sortedRecords.push({
            tool: req.name,
            args: req.args,
            result: { error: "Tool execution was interrupted" },
            requestId: req.id,
            order: req.order,
            status: "error",
          });
        }
      }
    }

    return {
      outcome,
      toolRecords: sortedRecords,
      ...(blockedApproval !== undefined ? { blockedApproval } : {}),
      haltedByHardFailure: hardFailureDetected,
    };
  }

  // =========================================================================
  // Non-streaming path — call chat(), parse, execute serially
  // =========================================================================
  const chatTimeout = llmTimeout?.chatTimeoutMs ?? 120_000;
  let chatTimer: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    llm.chat(messages, llmOptions),
    new Promise<never>((_, reject) => {
      chatTimer = setTimeout(() => reject(new Error(`LLM chat timeout after ${chatTimeout}ms`)), chatTimeout);
    }),
  ]);
  if (chatTimer) clearTimeout(chatTimer);
  const content = response.content;
  const finishReason = response.finishReason;
  const usage = response.usage;

  const toolRequests = parseToolRequests(content);
  const normalizedFinish = normalizeFinishReason(finishReason, toolRequests.length > 0);

  const outcome: ModelOutcome = {
    content,
    toolRequests,
    finishReason: normalizedFinish,
    ...(usage ? { usage } : {}),
  };

  if (toolRequests.length === 0) {
    return { outcome, toolRecords: [], haltedByHardFailure: false };
  }

  const records: AgentToolCallRecord[] = [];
  let blockedApproval:
    | { kind: "tool"; tool: string; args: unknown; reason: string }
    | undefined;
  let haltedByHardFailure = false;

  // Separate concurrent-safe and serial tool requests
  const concurrentBatch: Array<{ request: ToolRequest; tool: AgentTool }> = [];
  const serialBatch: Array<{ request: ToolRequest; tool: AgentTool }> = [];

  for (const request of toolRequests) {
    const tool = toolMap.get(request.name);
    if (!tool) {
      records.push({
        tool: request.name,
        args: request.args,
        result: { error: `Tool "${request.name}" not found` },
        requestId: request.id,
        order: request.order,
        status: "error",
      });
      continue;
    }

    if (tool.isConcurrencySafe && toolRequests.length > 1) {
      concurrentBatch.push({ request, tool });
    } else {
      serialBatch.push({ request, tool });
    }
  }

  // Execute concurrent-safe tools in parallel (two-phase: hooks serial, execute parallel)
  if (concurrentBatch.length > 0) {
    // Phase 1: Run beforeToolCall hooks serially to ensure deterministic ordering
    const approved: Array<{ request: ToolRequest; tool: AgentTool }> = [];
    let hookError: unknown;
    for (const { request, tool } of concurrentBatch) {
      if (blockedApproval) break;
      if (hooks?.beforeToolCall) {
        try {
          const policy = await hooks.beforeToolCall(request.name, request.args);
          if (!policy.allowed) {
            blockedApproval = {
              kind: "tool",
              tool: request.name,
              args: request.args,
              reason: policy.reason ?? "Blocked by policy",
            };
            break;
          }
        } catch (err) {
          // A hook threw (e.g. task persistence failed). Still run Phase 2
          // so already-approved tools can see the abort and settle properly.
          hookError = err;
          break;
        }
      }
      approved.push({ request, tool });
    }

    if (blockedApproval) {
      return { outcome, toolRecords: records, blockedApproval, haltedByHardFailure };
    }

    // Phase 2: Dispatch approved tools concurrently (hooks already called).
    // Even with hookError, we still run Phase 2 so aborted tools can settle
    // (harness propagates cancellation via AbortController, not executor).
    if (approved.length > 0) {
      const concurrentDispatcher = createConcurrentDispatcher(maxConcurrency);
      const concurrentResults: Map<number, SingleToolResult> = new Map();

      for (const { request, tool } of approved) {
        concurrentDispatcher.dispatch(async () => {
          if (haltedByHardFailure) return;
          const result = await executeToolCore(request, tool);
          concurrentResults.set(request.order, result);
          if (result.kind === "executed" && result.hardFailure) {
            haltedByHardFailure = true;
          }
        });
      }

      await concurrentDispatcher.waitAll();

      // Run afterToolCall hooks serially to avoid concurrent patchRun races
      for (const { request } of approved) {
        const result = concurrentResults.get(request.order);
        if (!result) continue;
        if (result.kind === "blocked") {
          blockedApproval = result.approval;
          return { outcome, toolRecords: records, blockedApproval, haltedByHardFailure };
        }
        records.push(result.record);
        if (hooks?.afterToolCall) {
          await hooks.afterToolCall(request.name, request.args, result.record.result, result.record.status ?? "success");
        }
      }
    }

    // Re-throw the hook error after approved tools have settled
    if (hookError !== undefined) {
      throw hookError;
    }
  }

  // Execute serial tools sequentially
  for (const { request, tool } of serialBatch) {
    if (haltedByHardFailure) break;

    const result = await executeSingleTool(
      request,
      tool,
      hooks,
    );

    if (result.kind === "blocked") {
      blockedApproval = result.approval;
      return { outcome, toolRecords: records, blockedApproval, haltedByHardFailure };
    }

    records.push(result.record);

    if (result.hardFailure) {
      haltedByHardFailure = true;
      break;
    }
  }

  // Synthetic tool_result for interrupted tools (skip on hard failure — intentional halt)
  if (!haltedByHardFailure) {
    for (const req of toolRequests) {
      const hasRecord = records.some(r => r.requestId === req.id);
      if (!hasRecord) {
        records.push({
          tool: req.name,
          args: req.args,
          result: { error: "Tool execution was interrupted" },
          requestId: req.id,
          order: req.order,
          status: "error",
        });
      }
    }
  }

  return { outcome, toolRecords: records, ...(blockedApproval !== undefined ? { blockedApproval } : {}), haltedByHardFailure };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, cloneUnknown(value)]),
  );
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneUnknown);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneUnknown(nested)]),
    );
  }
  return value;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
