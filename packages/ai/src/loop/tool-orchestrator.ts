import type {
  AgentTool,
  AgentToolCallRecord,
} from "../types.js";
import type { PendingToolExecution, RunAgentLoopOptions, TurnEngineState } from "./state.js";

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

      const shouldSkipPolicy = skipPolicyForFirstPendingTool && !policySkipConsumed;
      if (!shouldSkipPolicy && opts?.beforeToolCall) {
        const policy = await opts.beforeToolCall(request.name, request.args);
        if (!policy.allowed) {
          blockedApproval = {
            kind: "tool",
            tool: request.name,
            args: cloneArgs(request.args),
            reason: policy.reason ?? "Tool call blocked by policy",
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
      ? await Promise.all(approved.map((entry) => executeSingleTool(entry.tool, entry.request, opts)))
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
    records.push(await executeSingleTool(entry.tool, entry.request, opts));
  }
  return records;
}

async function executeSingleTool(
  tool: AgentTool,
  request: PendingToolExecution,
  _opts: RunAgentLoopOptions | undefined,
): Promise<{ request: PendingToolExecution; record: AgentToolCallRecord; hardFailure: boolean }> {
  let result: unknown;
  let status: "success" | "error" = "success";
  let hardFailure = false;

  try {
    result = await tool.execute(cloneArgs(request.args));
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
