/**
 * Check whether a required permission is satisfied by at least one entry in
 * the `granted` permission set.
 *
 * Permission strings follow the `resource:action` pattern.
 *
 * Wildcards:
 * - `*:read`  — allows `read` on any resource
 * - `ticket:*` — allows any action on `ticket`
 * - `*:*`     — full access (superuser)
 *
 * Examples:
 *   checkPermission({ resource: "ticket", action: "read" }, ["ticket:read"])  // true
 *   checkPermission({ resource: "ticket", action: "write" }, ["*:write"])     // true
 *   checkPermission({ resource: "ticket", action: "delete" }, ["ticket:*"])   // true
 *   checkPermission({ resource: "ticket", action: "delete" }, ["*:*"])        // true
 */
export function checkPermission(
  required: { resource: string; action: "read" | "write" | "delete" },
  granted: string[],
): boolean {
  for (const perm of granted) {
    const sepIndex = perm.indexOf(":");
    if (sepIndex === -1) continue; // malformed entry, skip

    const grantedResource = perm.slice(0, sepIndex);
    const grantedAction = perm.slice(sepIndex + 1);

    const resourceMatch =
      grantedResource === "*" || grantedResource === required.resource;
    const actionMatch =
      grantedAction === "*" || grantedAction === required.action;

    if (resourceMatch && actionMatch) return true;
  }

  return false;
}

/**
 * Derive a `{ resource, action }` pair from an agent capability mode and
 * an optional resource name.
 *
 * Mapping:
 * - `"read"`     → `{ resource, action: "read" }`
 * - `"write"`    → `{ resource, action: "write" }`
 * - `"external"` → `{ resource: "external", action: "write" }`
 *
 * When `resource` is omitted the wildcard `"*"` is used.
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
