import { describe, expect, it } from "bun:test";

import {
  assertHarnessAuthorized,
  filterHarnessAuthorizedItems,
  resolveHarnessAuthorization,
} from "../../packages/ai/src/harness/runtime/authz.ts";
import type {
  HarnessAccessContext,
  HarnessAuthorizationRequest,
  HarnessRunRecord,
} from "../../packages/ai/src/harness/types.ts";

function buildRun(id: string): HarnessRunRecord {
  return {
    id,
    goal: `goal:${id}`,
    status: "running",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 5,
    toolNames: [],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: `/artifacts/${id}`,
    },
    lastEventSequence: 0,
  };
}

function buildRequest(
  overrides: Partial<HarnessAuthorizationRequest> = {},
): HarnessAuthorizationRequest {
  return {
    action: "run:read",
    runId: "run-1",
    run: buildRun("run-1"),
    ...overrides,
  };
}

describe("harness authz utilities", () => {
  describe("resolveHarnessAuthorization", () => {
    it("allows by default when no authorizer is configured", async () => {
      const decision = await resolveHarnessAuthorization(undefined, buildRequest());
      expect(decision).toEqual({ allowed: true });
    });

    it("normalizes boolean and undefined authorizer responses", async () => {
      await expect(
        resolveHarnessAuthorization(async () => true, buildRequest()),
      ).resolves.toEqual({ allowed: true });
      await expect(
        resolveHarnessAuthorization(async () => undefined, buildRequest()),
      ).resolves.toEqual({ allowed: true });
      await expect(
        resolveHarnessAuthorization(async () => false, buildRequest()),
      ).resolves.toEqual({ allowed: false });
    });

    it("passes through structured decisions", async () => {
      const allowed = await resolveHarnessAuthorization(
        async () => ({
          allowed: true,
          reason: "operator approved",
        }),
        buildRequest(),
      );
      const denied = await resolveHarnessAuthorization(
        async () => ({
          allowed: false,
          reason: "missing grant",
        }),
        buildRequest(),
      );

      expect(allowed).toEqual({
        allowed: true,
        reason: "operator approved",
      });
      expect(denied).toEqual({
        allowed: false,
        reason: "missing grant",
      });
    });

    it("forwards the original request object to the authorizer", async () => {
      const seen: HarnessAuthorizationRequest[] = [];
      const request = buildRequest({
        action: "approval:approve",
        detail: {
          approvalId: "approval-1",
          tool: "ticket.delete",
        },
      });

      await resolveHarnessAuthorization(async (incoming) => {
        seen.push(incoming);
        return true;
      }, request);

      expect(seen).toEqual([request]);
    });
  });

  describe("assertHarnessAuthorized", () => {
    it("does not throw when access is allowed", async () => {
      await expect(
        assertHarnessAuthorized(
          async () => ({
            allowed: true,
            reason: "read allowed",
          }),
          buildRequest(),
        ),
      ).resolves.toBeUndefined();
    });

    it("renders denial messages without run ids", async () => {
      await expect(
        assertHarnessAuthorized(
          async () => false,
          buildRequest({
            action: "runtime_paths:read",
            runId: undefined,
            run: undefined,
          }),
        ),
      ).rejects.toThrow("Harness access denied for runtime_paths:read");
    });

    it("renders denial messages with run ids and reasons", async () => {
      await expect(
        assertHarnessAuthorized(
          async () => ({
            allowed: false,
            reason: "operator grant expired",
          }),
          buildRequest({
            action: "approval:deny",
            runId: "run-blocked",
          }),
        ),
      ).rejects.toThrow(
        "Harness access denied for approval:deny for run run-blocked: operator grant expired",
      );
    });
  });

  describe("filterHarnessAuthorizedItems", () => {
    it("returns a shallow copy when no authorizer is configured", async () => {
      const items = [{ id: "a" }, { id: "b" }] as const;
      const result = await filterHarnessAuthorizedItems(
        items,
        undefined,
        undefined,
        (item) => ({
          action: "run:read",
          runId: item.id,
        }),
      );

      expect(result).toEqual(items);
      expect(result).not.toBe(items);
    });

    it("preserves order while filtering denied items", async () => {
      const items = [
        { id: "run-1" },
        { id: "run-2" },
        { id: "run-3" },
        { id: "run-4" },
      ];

      const result = await filterHarnessAuthorizedItems(
        items,
        async (request) => request.runId === "run-2" || request.runId === "run-4",
        undefined,
        (item) => ({
          action: "run:read",
          runId: item.id,
        }),
      );

      expect(result).toEqual([
        { id: "run-2" },
        { id: "run-4" },
      ]);
    });

    it("supports async request builders and structured denials", async () => {
      const items = [
        { id: "artifact-1", runId: "run-1" },
        { id: "artifact-2", runId: "run-2" },
      ];
      const seen: HarnessAuthorizationRequest[] = [];

      const result = await filterHarnessAuthorizedItems(
        items,
        async (request) => {
          seen.push(request);
          return request.runId === "run-1"
            ? { allowed: true }
            : { allowed: false, reason: "artifact hidden" };
        },
        undefined,
        async (item) => ({
          action: "artifact:read",
          runId: item.runId,
          detail: {
            artifactId: item.id,
          },
        }),
      );

      expect(result).toEqual([{ id: "artifact-1", runId: "run-1" }]);
      expect(seen).toEqual([
        {
          action: "artifact:read",
          runId: "run-1",
          detail: { artifactId: "artifact-1" },
        },
        {
          action: "artifact:read",
          runId: "run-2",
          detail: { artifactId: "artifact-2" },
        },
      ]);
    });

    it("merges shared access context into every authorization request", async () => {
      const access: HarnessAccessContext = {
        subject: {
          id: "operator-1",
          role: "reviewer",
        },
        metadata: {
          source: "console",
        },
      };
      const seen: HarnessAuthorizationRequest[] = [];

      const result = await filterHarnessAuthorizedItems(
        [
          { id: "approval-1", runId: "run-1" },
          { id: "approval-2", runId: "run-1" },
        ],
        async (request) => {
          seen.push(request);
          return request.detail?.approvalId === "approval-1";
        },
        access,
        (item) => ({
          action: "approval:read",
          runId: item.runId,
          detail: {
            approvalId: item.id,
          },
        }),
      );

      expect(result).toEqual([{ id: "approval-1", runId: "run-1" }]);
      expect(seen).toEqual([
        {
          action: "approval:read",
          runId: "run-1",
          access,
          detail: { approvalId: "approval-1" },
        },
        {
          action: "approval:read",
          runId: "run-1",
          access,
          detail: { approvalId: "approval-2" },
        },
      ]);
    });

    it("treats undefined authorizer responses as allow and false responses as deny", async () => {
      const items = [
        { id: "summary-1", runId: "run-1" },
        { id: "summary-2", runId: "run-2" },
        { id: "summary-3", runId: "run-3" },
      ];

      const result = await filterHarnessAuthorizedItems(
        items,
        async (request) => {
          if (request.runId === "run-1") {
            return undefined;
          }
          if (request.runId === "run-2") {
            return false;
          }
          return { allowed: true, reason: "reviewed" };
        },
        undefined,
        (item) => ({
          action: "summary:read",
          runId: item.runId,
        }),
      );

      expect(result).toEqual([
        { id: "summary-1", runId: "run-1" },
        { id: "summary-3", runId: "run-3" },
      ]);
    });
  });
});
