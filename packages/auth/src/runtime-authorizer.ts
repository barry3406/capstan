import type { AuthGrant, AuthGrantRequirement } from "./types.js";
import { authorizeGrant, type AuthorizationDecision } from "./permissions.js";

export interface RuntimeGrantScope {
  runId?: string;
  approvalId?: string;
  artifactId?: string;
  taskId?: string;
  summaryId?: string;
  memoryId?: string;
  tool?: string;
}

export interface RuntimeGrantAttributes {
  memoryKind?: "session" | "persistent";
  approvalKind?: "tool" | "task";
}

export interface RuntimeGrantAuthorizerRequest {
  action: string;
  scope?: RuntimeGrantScope;
  attributes?: RuntimeGrantAttributes;
}

export interface RuntimeGrantAuthorizationResult extends AuthorizationDecision {
  matchedRequirement?: AuthGrantRequirement;
}

export type RuntimeGrantSupplier =
  | readonly (string | AuthGrant)[]
  | (() => readonly (string | AuthGrant)[] | Promise<readonly (string | AuthGrant)[]>);

function parseRuntimeAction(action: string): { resource: string; action: string } {
  const separator = action.indexOf(":");
  if (separator === -1) {
    return { resource: action, action: "read" };
  }
  return {
    resource: action.slice(0, separator),
    action: action.slice(separator + 1),
  };
}

function normalizedScope(
  scope: RuntimeGrantScope | undefined,
): Record<string, string> | undefined {
  if (!scope) {
    return undefined;
  }
  const entries = Object.entries(scope).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function requirement(
  resource: string,
  action: string,
  scope?: RuntimeGrantScope,
): AuthGrantRequirement {
  const nextScope = normalizedScope(scope);
  return {
    resource,
    action,
    ...(nextScope ? { scope: nextScope } : {}),
  };
}

function runScope(scope: RuntimeGrantScope | undefined): RuntimeGrantScope | undefined {
  return scope?.runId ? { runId: scope.runId } : undefined;
}

export function deriveRuntimeGrantRequirements(
  request: RuntimeGrantAuthorizerRequest,
): AuthGrantRequirement[] {
  const parsed = parseRuntimeAction(request.action);
  const scope = request.scope;
  const fallbackRunScope = runScope(scope);

  switch (request.action) {
    case "checkpoint:read":
      return [
        requirement("checkpoint", "read", scope),
        requirement("run", "read", fallbackRunScope),
      ];
    case "artifact:read":
      return [
        requirement("artifact", "read", scope),
        requirement("run", "read", fallbackRunScope),
      ];
    case "event:read":
      return [
        requirement("event", "read", scope),
        requirement("run", "read", fallbackRunScope),
      ];
    case "task:read":
      return [
        requirement("task", "read", scope),
        requirement("run", "read", fallbackRunScope),
      ];
    case "context:read":
      return [
        requirement("context", "read", scope),
        requirement("run", "read", fallbackRunScope),
      ];
    case "summary:read":
      return [
        requirement("summary", "read", scope),
        requirement("context", "read", fallbackRunScope),
        requirement("run", "read", fallbackRunScope),
      ];
    case "memory:read":
      return [
        requirement("memory", "read", scope),
        ...(request.attributes?.memoryKind === "session" && fallbackRunScope
          ? [
              requirement("context", "read", fallbackRunScope),
              requirement("run", "read", fallbackRunScope),
            ]
          : []),
      ];
    case "approval:read":
      return [
        requirement("approval", "read", scope),
        requirement("approval", "manage", scope),
      ];
    case "approval:approve":
      return [
        requirement("approval", "approve", scope),
        requirement("approval", "manage", scope),
      ];
    case "approval:deny":
      return [
        requirement("approval", "deny", scope),
        requirement("approval", "manage", scope),
      ];
    default:
      return [requirement(parsed.resource, parsed.action, scope)];
  }
}

export function authorizeRuntimeAction(
  request: RuntimeGrantAuthorizerRequest,
  granted: readonly (string | AuthGrant)[],
): RuntimeGrantAuthorizationResult {
  const requirements = deriveRuntimeGrantRequirements(request);
  let denied: RuntimeGrantAuthorizationResult | undefined;

  for (const current of requirements) {
    const decision = authorizeGrant(current, granted);
    if (decision.allowed) {
      return {
        ...decision,
        matchedRequirement: current,
      };
    }
    if (decision.matchedGrant?.effect === "deny") {
      denied = {
        ...decision,
        matchedRequirement: current,
      };
      break;
    }
  }

  if (denied) {
    return denied;
  }

  const matchedRequirement = requirements[0];
  return {
    allowed: false,
    reason: `No grant matched ${request.action}`,
    ...(matchedRequirement ? { matchedRequirement } : {}),
  };
}

async function resolveRuntimeGrants(
  supplier: RuntimeGrantSupplier,
): Promise<readonly (string | AuthGrant)[]> {
  if (typeof supplier === "function") {
    return supplier();
  }
  return supplier;
}

export function createRuntimeGrantAuthorizer(supplier: RuntimeGrantSupplier) {
  return async (request: RuntimeGrantAuthorizerRequest) =>
    authorizeRuntimeAction(request, await resolveRuntimeGrants(supplier));
}
