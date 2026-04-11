import type {
  ActorIdentity,
  DelegationLink,
  DelegationTargetRef,
  ExecutionIdentity,
  ExecutionKind,
} from "./types.js";

function buildExecutionId(kind: ExecutionKind, source: string): string {
  if (kind === "request") {
    return source;
  }
  return `${kind}:${source}`;
}

export function createExecutionIdentity(
  kind: ExecutionKind,
  source: string,
  options?: {
    parentId?: string;
    metadata?: Record<string, unknown>;
  },
): ExecutionIdentity {
  const execution: ExecutionIdentity = {
    kind,
    id: buildExecutionId(kind, source),
  };
  if (options?.parentId !== undefined) execution.parentId = options.parentId;
  if (options?.metadata !== undefined) execution.metadata = options.metadata;
  return execution;
}

export function createRequestExecution(
  request: Request,
  options?: {
    parentId?: string;
  },
): ExecutionIdentity {
  const url = new URL(request.url);
  const createOptions: {
    parentId?: string;
    metadata?: Record<string, unknown>;
  } = {
    metadata: {
      method: request.method,
      pathname: url.pathname,
      origin: url.origin,
    },
  };
  if (options?.parentId !== undefined) {
    createOptions.parentId = options.parentId;
  }
  return createExecutionIdentity(
    "request",
    `${request.method} ${url.pathname}`,
    createOptions,
  );
}

function toTargetRef(target: ActorIdentity | ExecutionIdentity): DelegationTargetRef {
  return {
    kind: target.kind,
    id: target.id,
  };
}

export function createDelegationLink(
  from: ActorIdentity | ExecutionIdentity,
  to: ActorIdentity | ExecutionIdentity,
  reason: string,
  metadata?: Record<string, unknown>,
): DelegationLink {
  const link: DelegationLink = {
    from: toTargetRef(from),
    to: toTargetRef(to),
    reason,
    issuedAt: new Date().toISOString(),
  };
  if (metadata !== undefined) {
    link.metadata = metadata;
  }
  return link;
}
