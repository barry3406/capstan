import type {
  AgentTool,
  AgentToolCallRecord,
  AgentToolExecutionContext,
  AgentToolProgressUpdate,
} from "../types.js";
import type { PendingToolExecution, RunAgentLoopOptions, TurnEngineState } from "./state.js";
import { createMailboxMessageId } from "./mailbox.js";
import { resolveToolGovernanceDecision } from "./governance.js";

const PARALLEL_ABORT_GRACE_MS = 50;

export interface ToolExecutionOutcome {
  records: AgentToolCallRecord[];
  blockedApproval?: { kind: "tool"; tool: string; args: unknown; reason: string } | undefined;
  haltedByHardFailure: boolean;
  remaining: PendingToolExecution[];
}

export async function executeToolRequests(
  state: TurnEngineState,
  requestsOrOptions: PendingToolExecution[] | RunAgentLoopOptions | undefined,
  optsOrSkip: RunAgentLoopOptions | boolean | undefined,
  maybeSkipPolicyForFirstPendingTool?: boolean,
): Promise<ToolExecutionOutcome> {
  const requests = Array.isArray(requestsOrOptions)
    ? requestsOrOptions
    : state.pendingToolRequests;
  const opts = Array.isArray(requestsOrOptions)
    ? (optsOrSkip as RunAgentLoopOptions | undefined)
    : (requestsOrOptions as RunAgentLoopOptions | undefined);
  const skipPolicyForFirstPendingTool = Array.isArray(requestsOrOptions)
    ? (maybeSkipPolicyForFirstPendingTool ?? false)
    : typeof optsOrSkip === "boolean"
      ? optsOrSkip
      : false;
  const availableTools = new Map<string, AgentTool>();
  for (const tool of state.availableTools) {
    if (!availableTools.has(tool.name)) {
      availableTools.set(tool.name, tool);
    }
  }
  const pending = requests.map((request) => ({
    ...request,
    args: cloneArgs(request.args),
  }));
  const groups = buildExecutionGroups(pending, availableTools);
  const records: AgentToolCallRecord[] = [];
  let blockedApproval: ToolExecutionOutcome["blockedApproval"];
  let remaining = pending;
  let haltedByHardFailure = false;
  let policySkipConsumed = false;

  for (const group of groups) {
    const approved: Array<{ request: PendingToolExecution; tool: AgentTool }> = [];

    for (const request of group.requests) {
      const tool = availableTools.get(request.name);
      if (!tool) {
        records.push({
          tool: request.name,
          args: cloneArgs(request.args),
          result: {
            error: `Tool "${request.name}" not found. Available tools: ${state.availableTools.map((entry) => entry.name).join(", ")}`,
          },
          requestId: request.id,
          order: request.order,
          status: "error",
        });
        remaining = remaining.filter((entry) => entry.id !== request.id);
        continue;
      }

      await opts?.onToolCall?.(request.name, cloneArgs(request.args));

      const shouldSkipPolicy = skipPolicyForFirstPendingTool && !policySkipConsumed;
      const governance = await resolveToolGovernanceDecision(
        opts,
        {
          runId: opts?.runId,
          requestId: request.id,
          order: request.order,
          kind: "tool",
          name: request.name,
          args: cloneArgs(request.args),
          assistantMessage: request.assistantMessage,
        },
        { skip: shouldSkipPolicy },
      );
      if (governance.action === "require_approval") {
          blockedApproval = {
            kind: "tool",
            tool: request.name,
            args: cloneArgs(request.args),
            reason: governance.reason ?? "Tool call blocked by policy",
          };
          remaining = remaining.slice(
            remaining.findIndex((entry) => entry.id === request.id),
          );
          return {
            records: sortRecords(records),
            blockedApproval,
            haltedByHardFailure,
            remaining,
          };
      }
      if (governance.action === "deny") {
        records.push({
          tool: request.name,
          args: cloneArgs(request.args),
          result: {
            error: governance.reason ?? `Tool "${request.name}" denied by governance`,
            governance: governanceToResult(governance),
          },
          requestId: request.id,
          order: request.order,
          status: "error",
        });
        remaining = remaining.filter((entry) => entry.id !== request.id);
        haltedByHardFailure = haltedByHardFailure || tool.failureMode === "hard";
        if (haltedByHardFailure) {
          return {
            records: sortRecords(records),
            haltedByHardFailure,
            remaining,
          };
        }
        continue;
      }
      if (shouldSkipPolicy) {
        policySkipConsumed = true;
      }

      approved.push({ request, tool });
    }

    if (approved.length === 0) {
      continue;
    }

    const executed = group.parallel
      ? await executeInParallel(approved, opts)
      : await executeSerially(approved, opts);

    const orderedExecuted = executed
      .slice()
      .sort((left, right) => (left.record.order ?? 0) - (right.record.order ?? 0));

    for (const entry of orderedExecuted) {
      if (opts?.afterToolCall) {
        await opts.afterToolCall(
          entry.record.tool,
          entry.record.args,
          entry.record.result,
        );
      }

      if (opts?.onMemoryEvent) {
        await opts.onMemoryEvent(
          `Tool ${entry.record.tool} called with ${JSON.stringify(entry.record.args)} => ${JSON.stringify(entry.record.result)}`,
        );
      }
    }

    for (const record of orderedExecuted) {
      records.push(record.record);
      remaining = remaining.filter((entry) => entry.id !== record.request.id);
      if (record.hardFailure) {
        haltedByHardFailure = true;
      }
    }

    if (haltedByHardFailure) {
      break;
    }
  }

  return {
    records: sortRecords(records),
    ...(blockedApproval ? { blockedApproval } : {}),
    haltedByHardFailure,
    remaining,
  };
}

function buildExecutionGroups(
  requests: PendingToolExecution[],
  availableTools: Map<string, AgentTool>,
): Array<{ parallel: boolean; requests: PendingToolExecution[] }> {
  const groups: Array<{ parallel: boolean; requests: PendingToolExecution[] }> = [];

  for (const request of requests) {
    const tool = availableTools.get(request.name);
    const parallel = tool?.isConcurrencySafe === true;
    const previous = groups[groups.length - 1];
    if (parallel && previous?.parallel) {
      previous.requests.push(request);
      continue;
    }
    groups.push({ parallel, requests: [request] });
  }

  return groups;
}

async function executeSerially(
  approved: Array<{ request: PendingToolExecution; tool: AgentTool }>,
  opts: RunAgentLoopOptions | undefined,
): Promise<Array<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }>> {
  const records: Array<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }> = [];
  for (const entry of approved) {
    records.push(await executeSingleTool(entry.tool, entry.request, opts, new AbortController()));
  }
  return records;
}

async function executeInParallel(
  approved: Array<{ request: PendingToolExecution; tool: AgentTool }>,
  opts: RunAgentLoopOptions | undefined,
): Promise<Array<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }>> {
  const controllers = new Map<string, AbortController>();
  const settled = new Set<string>();
  const executions = approved.map((entry) => {
    const controller = new AbortController();
    controllers.set(entry.request.id, controller);
    return withAbortGuard(
      entry,
      controller,
      executeSingleTool(entry.tool, entry.request, opts, controller),
    ).then((result) => {
      settled.add(entry.request.id);
      if (result.hardFailure) {
        for (const [requestId, siblingController] of controllers.entries()) {
          if (requestId === entry.request.id || settled.has(requestId)) {
            continue;
          }
          siblingController.abort(`Tool ${entry.tool.name} failed hard`);
        }
      }
      return result;
    });
  });
  return Promise.all(executions);
}

async function executeSingleTool(
  tool: AgentTool,
  request: PendingToolExecution,
  opts: RunAgentLoopOptions | undefined,
  controller: AbortController,
): Promise<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }> {
  let result: unknown;
  let status: "success" | "error" = "success";
  let hardFailure = false;

  try {
    const context: AgentToolExecutionContext = {
      signal: controller.signal,
      runId: opts?.runId,
      requestId: request.id,
      order: request.order,
    };
    if (tool.executeStreaming) {
      result = await executeStreamingTool(tool, request, opts, context);
    } else {
      result = await tool.execute(cloneArgs(request.args), context);
    }
  } catch (error) {
    status = "error";
    result = {
      error: error instanceof Error ? error.message : String(error),
    };
    hardFailure = tool.failureMode === "hard";
  }

  return {
    request,
    record: {
      tool: tool.name,
      args: cloneArgs(request.args),
      result,
      requestId: request.id,
      order: request.order,
      status,
    },
    hardFailure,
  };
}

async function executeStreamingTool(
  tool: AgentTool,
  request: PendingToolExecution,
  opts: RunAgentLoopOptions | undefined,
  context: AgentToolExecutionContext,
): Promise<unknown> {
  let finalResult: unknown = undefined;
  for await (const update of tool.executeStreaming!(
    cloneArgs(request.args),
    context,
  )) {
    if (update.type === "result") {
      finalResult = cloneUnknown(update.result);
      continue;
    }
    const progressUpdate: AgentToolProgressUpdate = {
      type: "progress",
      message: update.message,
      ...(update.detail ? { detail: cloneUnknown(update.detail) as Record<string, unknown> } : {}),
    };
    await emitToolProgressSafely(tool, request, progressUpdate, opts);
  }
  if (finalResult === undefined) {
    throw new Error(`Streaming tool "${tool.name}" completed without a result update`);
  }
  return finalResult;
}

function withAbortGuard(
  entry: { request: PendingToolExecution; tool: AgentTool },
  controller: AbortController,
  execution: Promise<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }>,
): Promise<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }> {
  return Promise.race([
    execution,
    new Promise<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        timeout = setTimeout(() => {
          resolve({
            request: entry.request,
            record: {
              tool: entry.tool.name,
              args: cloneArgs(entry.request.args),
              result: {
                error: `Tool "${entry.tool.name}" aborted after sibling hard failure: ${String(controller.signal.reason ?? "aborted")}`,
              },
              requestId: entry.request.id,
              order: entry.request.order,
              status: "error",
            },
            hardFailure: false,
          });
        }, PARALLEL_ABORT_GRACE_MS);
      };

      if (controller.signal.aborted) {
        onAbort();
      } else {
        controller.signal.addEventListener("abort", onAbort, { once: true });
      }

      void execution.finally(() => {
        controller.signal.removeEventListener("abort", onAbort);
        if (timeout) {
          clearTimeout(timeout);
        }
      });
    }),
  ]);
}

async function emitToolProgressSafely(
  tool: AgentTool,
  request: PendingToolExecution,
  progressUpdate: AgentToolProgressUpdate,
  opts: RunAgentLoopOptions | undefined,
): Promise<void> {
  try {
    await opts?.onToolProgress?.(tool.name, cloneArgs(request.args), progressUpdate);
  } catch {
    // Progress sinks are observational. A broken observer must not convert a
    // successful tool execution into a tool failure.
  }

  if (opts?.mailbox && opts.runId) {
    try {
      await opts.mailbox.publish({
        id: createMailboxMessageId("tool_progress"),
        runId: opts.runId,
        createdAt: new Date().toISOString(),
        kind: "tool_progress",
        tool: tool.name,
        requestId: request.id,
        order: request.order,
        message: progressUpdate.message,
        ...(progressUpdate.detail ? { detail: progressUpdate.detail } : {}),
      });
    } catch {
      // Mailbox publication is best-effort for progress updates.
    }
  }
}

function sortRecords(records: AgentToolCallRecord[]): AgentToolCallRecord[] {
  return records
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, cloneUnknown(value)]),
  );
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneUnknown);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        cloneUnknown(nested),
      ]),
    );
  }
  return value;
}

function governanceToResult(value: {
  action: string;
  reason?: string;
  policyId?: string;
  risk?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    action: value.action,
    ...(value.reason ? { reason: value.reason } : {}),
    ...(value.policyId ? { policyId: value.policyId } : {}),
    ...(value.risk ? { risk: value.risk } : {}),
    ...(value.source ? { source: value.source } : {}),
    ...(value.metadata ? { metadata: cloneUnknown(value.metadata) as Record<string, unknown> } : {}),
  };
}
