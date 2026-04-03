import type { RuntimeGrantSupplier } from "./runtime-authorizer.js";
import {
  createRuntimeGrantAuthorizer,
  type RuntimeGrantAuthorizationResult,
  type RuntimeGrantAuthorizerRequest,
} from "./runtime-authorizer.js";

export interface HarnessGrantAuthorizationRequest {
  action: string;
  runId?: string;
  detail?: Record<string, unknown>;
}

function readString(
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readRecord(
  source: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = source?.[key];
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function deriveMemoryAttributes(
  detail: Record<string, unknown> | undefined,
): RuntimeGrantAuthorizerRequest["attributes"] {
  const kind = readString(detail, "kind");
  if (kind === "session_memory") {
    return { memoryKind: "session" };
  }
  if (kind === "persistent_memory") {
    return { memoryKind: "persistent" };
  }

  const kinds = Array.isArray(detail?.["kinds"])
    ? detail["kinds"].filter((entry): entry is string => typeof entry === "string")
    : [];
  if (kinds.length === 1 && kinds[0] === "session_memory") {
    return { memoryKind: "session" };
  }
  if (kinds.length === 1 && kinds[0] === "persistent_memory") {
    return { memoryKind: "persistent" };
  }
  return undefined;
}

function deriveApprovalAttributes(
  detail: Record<string, unknown> | undefined,
): RuntimeGrantAuthorizerRequest["attributes"] {
  const pendingApproval = readRecord(detail, "pendingApproval");
  const directKind = readString(detail, "kind");
  const nestedKind = readString(pendingApproval, "kind");
  const approvalKind =
    directKind === "tool" || directKind === "task"
      ? directKind
      : nestedKind === "tool" || nestedKind === "task"
        ? nestedKind
        : undefined;

  return approvalKind ? { approvalKind } : undefined;
}

function buildScope(
  request: HarnessGrantAuthorizationRequest,
): RuntimeGrantAuthorizerRequest["scope"] {
  if (request.action.endsWith(":list")) {
    return request.runId ? { runId: request.runId } : undefined;
  }
  const detail = request.detail;
  const pendingApproval = readRecord(detail, "pendingApproval");
  const pendingToolCall = readRecord(detail, "pendingToolCall");
  const scope: Record<string, string> = {};

  if (request.runId) {
    scope.runId = request.runId;
  }

  const scopedFields: Array<[string, string | undefined]> = [
    ["approvalId", readString(detail, "approvalId") ?? readString(pendingApproval, "id")],
    ["artifactId", readString(detail, "artifactId")],
    ["memoryId", readString(detail, "memoryId")],
    ["summaryId", readString(detail, "summaryId")],
    ["taskId", readString(detail, "taskId")],
    [
      "tool",
      readString(detail, "tool") ??
        readString(pendingApproval, "tool") ??
        readString(pendingToolCall, "tool"),
    ],
  ];

  for (const [key, value] of scopedFields) {
    if (value) {
      scope[key] = value;
    }
  }

  return Object.keys(scope).length > 0 ? scope : undefined;
}

export function toRuntimeGrantRequest(
  request: HarnessGrantAuthorizationRequest,
): RuntimeGrantAuthorizerRequest {
  const detail = request.detail;
  const attributes = {
    ...(request.action.startsWith("memory:") ? deriveMemoryAttributes(detail) ?? {} : {}),
    ...(request.action.startsWith("approval:") ? deriveApprovalAttributes(detail) ?? {} : {}),
  };
  const scope = buildScope(request);

  return {
    action: request.action,
    ...(scope ? { scope } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}

export function createHarnessGrantAuthorizer(supplier: RuntimeGrantSupplier) {
  const runtimeAuthorizer = createRuntimeGrantAuthorizer(supplier);

  return async (
    request: HarnessGrantAuthorizationRequest,
  ): Promise<RuntimeGrantAuthorizationResult> =>
    runtimeAuthorizer(toRuntimeGrantRequest(request));
}
