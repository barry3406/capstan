import type {
  AuthGrant,
  AuthGrantRequirement,
} from "./types.js";
import { createGrant } from "./runtime-grants.js";

export interface AuthorizationDecision {
  allowed: boolean;
  matchedGrant?: AuthGrant;
  reason?: string;
}

function isGrantRecord(value: unknown): value is AuthGrant {
  return (
    typeof value === "object" &&
    value !== null &&
    "resource" in value &&
    "action" in value &&
    typeof (value as Record<string, unknown>)["resource"] === "string" &&
    typeof (value as Record<string, unknown>)["action"] === "string"
  );
}

function parsePermission(permission: string): AuthGrant | null {
  const sepIndex = permission.indexOf(":");
  if (sepIndex === -1) return null;
  return createGrant(permission.slice(0, sepIndex), permission.slice(sepIndex + 1));
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

function resourceMatches(required: string, granted: string): boolean {
  return granted === "*" || granted === required;
}

function actionMatches(required: string, granted: string): boolean {
  return granted === "*" || granted === required;
}

function isGrantExpired(grant: AuthGrant): boolean {
  if (grant.expiresAt === undefined) return false;
  const expiresAt = Date.parse(grant.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function normalizePermissionsToGrants(
  granted: readonly (string | AuthGrant)[],
): AuthGrant[] {
  const grants: AuthGrant[] = [];
  for (const entry of granted) {
    if (typeof entry === "string") {
      const parsed = parsePermission(entry);
      if (parsed) grants.push(parsed);
      continue;
    }
    if (isGrantRecord(entry)) {
      grants.push(entry);
    }
  }
  return grants;
}

export function serializeGrantsToPermissions(grants: readonly AuthGrant[]): string[] {
  return grants.map((grant) => `${grant.resource}:${grant.action}`);
}

export function authorizeGrant(
  required: AuthGrantRequirement,
  granted: readonly (string | AuthGrant)[],
): AuthorizationDecision {
  const grants = normalizePermissionsToGrants(granted);
  let matchedAllowGrant: AuthGrant | undefined;
  for (const grant of grants) {
    if (isGrantExpired(grant)) continue;
    const matches =
      resourceMatches(required.resource, grant.resource) &&
      actionMatches(required.action, grant.action) &&
      scopeMatches(required.scope, grant.scope);
    if (!matches) continue;
    if (grant.effect === "deny") {
      return {
        allowed: false,
        matchedGrant: grant,
        reason: `Grant explicitly denied ${required.resource}:${required.action}`,
      };
    }
    matchedAllowGrant = grant;
  }
  if (matchedAllowGrant) {
    return { allowed: true, matchedGrant: matchedAllowGrant };
  }
  return {
    allowed: false,
    reason: `No grant matched ${required.resource}:${required.action}`,
  };
}

export function checkGrant(
  required: AuthGrantRequirement,
  granted: readonly (string | AuthGrant)[],
): boolean {
  return authorizeGrant(required, granted).allowed;
}

/**
 * Check whether a required permission is satisfied by at least one entry in
 * the granted permission / grant set.
 */
export function checkPermission(
  required: { resource: string; action: "read" | "write" | "delete" },
  granted: readonly (string | AuthGrant)[],
): boolean {
  return checkGrant(required, granted);
}

/**
 * Derive a `{ resource, action }` pair from an agent capability mode and
 * an optional resource name.
 */
export function derivePermission(
  capability: "read" | "write" | "external",
  resource?: string,
): { resource: string; action: string } {
  if (capability === "external") {
    return { resource: "external", action: "write" };
  }

  return {
    resource: resource ?? "*",
    action: capability,
  };
}
