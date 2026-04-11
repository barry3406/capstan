import type { AuthGrant } from "./types.js";

export function createGrant(
  resource: string,
  action: string,
  options?: {
    scope?: Record<string, string>;
    expiresAt?: string;
    constraints?: Record<string, unknown>;
    effect?: "allow" | "deny";
  },
): AuthGrant {
  const grant: AuthGrant = { resource, action };
  if (options?.scope !== undefined) grant.scope = options.scope;
  if (options?.expiresAt !== undefined) grant.expiresAt = options.expiresAt;
  if (options?.constraints !== undefined) grant.constraints = options.constraints;
  if (options?.effect !== undefined) grant.effect = options.effect;
  return grant;
}

export function grantRunActions(
  runId: string,
  actions: readonly string[] = ["read", "pause", "cancel", "resume"],
): AuthGrant[] {
  return actions.map((action) =>
    createGrant("run", action, {
      scope: { runId },
    }),
  );
}

export function grantApprovalActions(
  actions: readonly string[] = ["read", "approve", "deny", "manage"],
  options?: {
    approvalId?: string;
    runId?: string;
    tool?: string;
  },
): AuthGrant[] {
  const scope: Record<string, string> = {};
  if (options?.approvalId !== undefined) scope.approvalId = options.approvalId;
  if (options?.runId !== undefined) scope.runId = options.runId;
  if (options?.tool !== undefined) scope.tool = options.tool;
  return actions.map((action) =>
    createGrant("approval", action, {
      ...(Object.keys(scope).length > 0 ? { scope } : {}),
    }),
  );
}

export function grantApprovalCollectionActions(
  actions: readonly string[] = ["list"],
  options?: {
    runId?: string;
  },
): AuthGrant[] {
  return actions.map((action) =>
    createGrant("approval", action, {
      ...(options?.runId ? { scope: { runId: options.runId } } : {}),
    }),
  );
}

export function grantArtifactActions(
  runId: string,
  actions: readonly string[] = ["read"],
  artifactId?: string,
): AuthGrant[] {
  const scope: Record<string, string> = { runId };
  if (artifactId !== undefined) scope.artifactId = artifactId;
  return actions.map((action) =>
    createGrant("artifact", action, {
      scope,
    }),
  );
}

export function grantCheckpointActions(
  runId: string,
  actions: readonly string[] = ["read"],
): AuthGrant[] {
  return actions.map((action) =>
    createGrant("checkpoint", action, {
      scope: { runId },
    }),
  );
}

export function grantRunCollectionActions(
  actions: readonly string[] = ["start", "list"],
): AuthGrant[] {
  return actions.map((action) => createGrant("run", action));
}

export function grantEventActions(
  runId: string,
  actions: readonly string[] = ["read"],
): AuthGrant[] {
  return actions.map((action) =>
    createGrant("event", action, {
      scope: { runId },
    }),
  );
}

export function grantEventCollectionActions(
  actions: readonly string[] = ["list"],
): AuthGrant[] {
  return actions.map((action) => createGrant("event", action));
}

export function grantTaskActions(
  runId: string,
  actions: readonly string[] = ["read"],
  taskId?: string,
): AuthGrant[] {
  const scope: Record<string, string> = { runId };
  if (taskId !== undefined) scope.taskId = taskId;
  return actions.map((action) =>
    createGrant("task", action, {
      scope,
    }),
  );
}

export function grantSummaryActions(
  runId: string,
  actions: readonly string[] = ["read"],
  summaryId?: string,
): AuthGrant[] {
  const scope: Record<string, string> = { runId };
  if (summaryId !== undefined) scope.summaryId = summaryId;
  return actions.map((action) =>
    createGrant("summary", action, {
      scope,
    }),
  );
}

export function grantSummaryCollectionActions(
  actions: readonly string[] = ["list"],
): AuthGrant[] {
  return actions.map((action) => createGrant("summary", action));
}

export function grantMemoryActions(
  actions: readonly string[] = ["read"],
  options?: {
    runId?: string;
    memoryId?: string;
  },
): AuthGrant[] {
  const scope: Record<string, string> = {};
  if (options?.runId !== undefined) scope.runId = options.runId;
  if (options?.memoryId !== undefined) scope.memoryId = options.memoryId;
  return actions.map((action) =>
    createGrant("memory", action, {
      ...(Object.keys(scope).length > 0 ? { scope } : {}),
    }),
  );
}

export function grantContextActions(
  runId: string,
  actions: readonly string[] = ["read"],
): AuthGrant[] {
  return actions.map((action) =>
    createGrant("context", action, {
      scope: { runId },
    }),
  );
}

export function grantRuntimePathsActions(
  actions: readonly string[] = ["read"],
): AuthGrant[] {
  return actions.map((action) => createGrant("runtime_paths", action));
}
