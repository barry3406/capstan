import type {
  HarnessAccessContext,
  HarnessAuthorizationDecision,
  HarnessAuthorizationHook,
  HarnessAuthorizationRequest,
} from "../types.js";

function deniedDecision(reason?: string): HarnessAuthorizationDecision {
  return {
    allowed: false,
    ...(reason ? { reason } : {}),
  };
}

export async function resolveHarnessAuthorization(
  authorize: HarnessAuthorizationHook | undefined,
  request: HarnessAuthorizationRequest,
): Promise<HarnessAuthorizationDecision> {
  if (!authorize) {
    return { allowed: true };
  }

  const decision = await authorize(request);
  if (decision === false) {
    return deniedDecision();
  }
  if (decision === true || decision === undefined) {
    return { allowed: true };
  }
  return decision;
}

function formatHarnessDeniedMessage(
  request: HarnessAuthorizationRequest,
  reason?: string,
): string {
  const runSegment = request.runId ? ` for run ${request.runId}` : "";
  const reasonSegment = reason ? `: ${reason}` : "";
  return `Harness access denied for ${request.action}${runSegment}${reasonSegment}`;
}

export async function assertHarnessAuthorized(
  authorize: HarnessAuthorizationHook | undefined,
  request: HarnessAuthorizationRequest,
): Promise<void> {
  const decision = await resolveHarnessAuthorization(authorize, request);
  if (!decision.allowed) {
    throw new Error(formatHarnessDeniedMessage(request, decision.reason));
  }
}

export async function filterHarnessAuthorizedItems<T>(
  items: readonly T[],
  authorize: HarnessAuthorizationHook | undefined,
  access: HarnessAccessContext | undefined,
  toRequest: (item: T) => HarnessAuthorizationRequest | Promise<HarnessAuthorizationRequest>,
): Promise<T[]> {
  if (!authorize) {
    return [...items];
  }

  const decisions = await Promise.all(
    items.map(async (item) => {
      const request = await toRequest(item);
      return resolveHarnessAuthorization(authorize, {
        ...request,
        ...(access ? { access } : {}),
      });
    }),
  );

  return items.filter((_, index) => decisions[index]?.allowed === true);
}
