import type {
  CapstanAuthContext,
  CapstanAuthGrant,
} from "./types.js";

export interface CapstanAuthRequirement {
  resource: string;
  action: string;
  scope?: Record<string, string>;
}

function parsePermission(permission: string): CapstanAuthGrant | null {
  const sepIndex = permission.indexOf(":");
  if (sepIndex === -1) return null;
  return {
    resource: permission.slice(0, sepIndex),
    action: permission.slice(sepIndex + 1),
  };
}

function isExpired(grant: CapstanAuthGrant): boolean {
  if (grant.expiresAt === undefined) return false;
  const expiresAt = Date.parse(grant.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function scopeMatches(
  required: Record<string, string> | undefined,
  granted: Record<string, string> | undefined,
): boolean {
  if (!required || Object.keys(required).length === 0) return true;
  if (!granted) return false;
  for (const [key, value] of Object.entries(required)) {
    const grantedValue = granted[key];
    if (grantedValue !== "*" && grantedValue !== value) {
      return false;
    }
  }
  return true;
}

function matchesGrant(
  required: CapstanAuthRequirement,
  grant: CapstanAuthGrant,
): boolean {
  const resourceMatch = grant.resource === "*" || grant.resource === required.resource;
  const actionMatch = grant.action === "*" || grant.action === required.action;
  return resourceMatch && actionMatch && scopeMatches(required.scope, grant.scope);
}

export function collectAuthGrants(auth: CapstanAuthContext): CapstanAuthGrant[] {
  const grants: CapstanAuthGrant[] = [];
  for (const permission of auth.permissions ?? []) {
    const parsed = parsePermission(permission);
    if (parsed) grants.push(parsed);
  }
  for (const grant of auth.grants ?? []) {
    grants.push(grant);
  }
  for (const grant of auth.envelope?.grants ?? []) {
    grants.push(grant);
  }
  return grants;
}

export function hasAuthGrant(
  auth: CapstanAuthContext,
  required: CapstanAuthRequirement,
): boolean {
  let matchedAllow = false;
  for (const grant of collectAuthGrants(auth)) {
    if (isExpired(grant) || !matchesGrant(required, grant)) continue;
    if (grant.effect === "deny") return false;
    matchedAllow = true;
  }
  return matchedAllow;
}

export function buildAuditAuthSnapshot(auth: CapstanAuthContext): {
  type: string;
  userId?: string;
  agentId?: string;
  actor?: {
    kind: string;
    id: string;
    displayName?: string;
  };
  grants?: Array<Pick<CapstanAuthGrant, "resource" | "action" | "scope">>;
} {
  const snapshot: {
    type: string;
    userId?: string;
    agentId?: string;
    actor?: {
      kind: string;
      id: string;
      displayName?: string;
    };
    grants?: Array<Pick<CapstanAuthGrant, "resource" | "action" | "scope">>;
  } = {
    type: auth.type,
  };
  if (auth.userId !== undefined) snapshot.userId = auth.userId;
  if (auth.agentId !== undefined) snapshot.agentId = auth.agentId;
  const actor = auth.actor ?? auth.envelope?.actor;
  if (actor) {
    snapshot.actor = {
      kind: actor.kind,
      id: actor.id,
      ...(actor.displayName !== undefined ? { displayName: actor.displayName } : {}),
    };
  }
  const grants = collectAuthGrants(auth).map((grant) => ({
    resource: grant.resource,
    action: grant.action,
    ...(grant.scope !== undefined ? { scope: grant.scope } : {}),
  }));
  if (grants.length > 0) {
    snapshot.grants = grants;
  }
  return snapshot;
}
