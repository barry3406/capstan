import { describe, it, expect } from "bun:test";
import {
  authorizeGrant,
  checkGrant,
  checkPermission,
  createGrant,
  derivePermission,
  normalizePermissionsToGrants,
  serializeGrantsToPermissions,
} from "@zauso-ai/capstan-auth";

describe("auth grants", () => {
  it("normalizes legacy permission strings and structured grants together", () => {
    const grants = normalizePermissionsToGrants([
      "ticket:read",
      "broken-entry",
      createGrant("run", "resume", { scope: { runId: "run-9" } }),
      createGrant("approval", "manage", {
        scope: { approvalId: "approval-7" },
      }),
    ]);

    expect(grants).toHaveLength(3);
    expect(grants[0]).toMatchObject({ resource: "ticket", action: "read" });
    expect(grants[1]).toMatchObject({ resource: "run", action: "resume" });
    expect(grants[2]).toMatchObject({ resource: "approval", action: "manage" });
  });

  it("round-trips structured grants back into legacy permission strings", () => {
    const grants = [
      createGrant("ticket", "read"),
      createGrant("run", "pause", { scope: { runId: "run-1" } }),
      createGrant("artifact", "read", { scope: { runId: "run-1" } }),
    ];

    expect(serializeGrantsToPermissions(grants)).toEqual([
      "ticket:read",
      "run:pause",
      "artifact:read",
    ]);
  });

  it("authorizes exact, wildcard, and scoped matches", () => {
    const granted = [
      createGrant("ticket", "read"),
      createGrant("*", "write"),
      createGrant("run", "resume", { scope: { runId: "run-1" } }),
    ];

    expect(
      authorizeGrant({ resource: "ticket", action: "read" }, granted).allowed,
    ).toBe(true);
    expect(
      authorizeGrant({ resource: "ticket", action: "write" }, granted).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "run", action: "resume", scope: { runId: "run-1" } },
        granted,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "run", action: "resume", scope: { runId: "run-2" } },
        granted,
      ).allowed,
    ).toBe(false);
  });

  it("rejects expired grants even when everything else matches", () => {
    const expired = createGrant("checkpoint", "read", {
      scope: { runId: "run-1" },
      expiresAt: "2024-01-01T00:00:00.000Z",
    });

    expect(
      authorizeGrant(
        { resource: "checkpoint", action: "read", scope: { runId: "run-1" } },
        [expired],
      ).allowed,
    ).toBe(false);
  });

  it("gives deny grants precedence over allow grants", () => {
    const granted = [
      createGrant("artifact", "read", { scope: { runId: "run-1" } }),
      createGrant("artifact", "read", {
        scope: { runId: "run-1" },
        effect: "deny",
      }),
    ];

    const result = authorizeGrant(
      { resource: "artifact", action: "read", scope: { runId: "run-1" } },
      granted,
    );

    expect(result.allowed).toBe(false);
    expect(result.matchedGrant?.effect).toBe("deny");
  });

  it("keeps legacy helper semantics for checkPermission and checkGrant", () => {
    const grants = [
      "audit:read",
      createGrant("run", "pause", { scope: { runId: "run-1" } }),
    ];

    expect(
      checkPermission({ resource: "audit", action: "read" }, grants),
    ).toBe(true);
    expect(
      checkGrant(
        { resource: "run", action: "pause", scope: { runId: "run-1" } },
        grants,
      ),
    ).toBe(true);
    expect(
      checkPermission({ resource: "audit", action: "delete" }, grants),
    ).toBe(false);
  });

  it("derives permissions from capability-first route metadata", () => {
    expect(derivePermission("read", "ticket")).toEqual({
      resource: "ticket",
      action: "read",
    });
    expect(derivePermission("write")).toEqual({
      resource: "*",
      action: "write",
    });
    expect(derivePermission("external", "api")).toEqual({
      resource: "external",
      action: "write",
    });
  });
});
