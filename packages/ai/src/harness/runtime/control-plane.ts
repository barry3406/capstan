import type {
  HarnessAccessContext,
  HarnessApprovalRecord,
  HarnessApprovalResolutionOptions,
  HarnessAuthorizedAction,
  HarnessAuthorizationRequest,
  HarnessControlPlane,
  HarnessControlPlaneOptions,
  HarnessRunRecord,
} from "../types.js";
import { HarnessContextKernel } from "../context/kernel.js";
import {
  buildApprovalDetail,
  ensureRunApprovalRecord,
  resolveRunApproval,
} from "./approvals.js";
import { assertHarnessAuthorized, filterHarnessAuthorizedItems } from "./authz.js";
import { FileHarnessRunMailbox } from "./mailbox.js";
import { FileHarnessRuntimeStore } from "./store.js";
import {
  projectApprovalInbox,
  projectArtifactFeed,
  projectRunTimeline,
  projectTaskBoard,
} from "../graph/projectors.js";

function resolveOpenHarnessRuntimeOptions(
  rootDirOrOptions?: string | HarnessControlPlaneOptions,
  options?: Omit<HarnessControlPlaneOptions, "rootDir">,
): Required<Pick<HarnessControlPlaneOptions, "rootDir">> & HarnessControlPlaneOptions {
  if (typeof rootDirOrOptions === "string") {
    return {
      rootDir: rootDirOrOptions,
      ...(options?.authorize ? { authorize: options.authorize } : {}),
    };
  }

  return {
    rootDir: rootDirOrOptions?.rootDir ?? process.cwd(),
    ...(rootDirOrOptions?.authorize ? { authorize: rootDirOrOptions.authorize } : {}),
  };
}

function buildAuthorizationRequest(input: {
  action: HarnessAuthorizedAction;
  runId?: string;
  run?: HarnessRunRecord;
  access?: HarnessAccessContext;
  detail?: Record<string, unknown>;
}): HarnessAuthorizationRequest {
  return {
    action: input.action,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.run ? { run: input.run } : {}),
    ...(input.access ? { access: input.access } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export async function openHarnessRuntime(
  rootDirOrOptions?: string | HarnessControlPlaneOptions,
  options?: Omit<HarnessControlPlaneOptions, "rootDir">,
): Promise<HarnessControlPlane> {
  const runtimeOptions = resolveOpenHarnessRuntimeOptions(rootDirOrOptions, options);
  const authorize = runtimeOptions.authorize;
  const runCache = new Map<string, Promise<HarnessRunRecord | undefined>>();
  const store = new FileHarnessRuntimeStore(runtimeOptions.rootDir);
  await store.initialize();
  const mailbox = new FileHarnessRunMailbox(store.paths);
  const contextKernel = new HarnessContextKernel(store);
  await contextKernel.initialize();

  function getCachedRun(runId: string): Promise<HarnessRunRecord | undefined> {
    let cached = runCache.get(runId);
    if (!cached) {
      cached = store.getRun(runId);
      runCache.set(runId, cached);
    }
    return cached;
  }

  async function requireAuthorizedRun(
    runId: string,
    action: "run:pause" | "run:cancel" | "run:resume" | "run:replay",
    access?: HarnessAccessContext,
  ): Promise<HarnessRunRecord> {
    const run = await store.requireRun(runId);
    await assertHarnessAuthorized(
      authorize,
      buildAuthorizationRequest({
        action,
        runId,
        run,
        ...(access ? { access } : {}),
      }),
    );
    return run;
  }

  async function requirePendingApproval(
    runId: string,
  ): Promise<{ run: HarnessRunRecord; approval: HarnessApprovalRecord }> {
    const run = await store.requireRun(runId);
    return ensureRunApprovalRecord(store, run);
  }

  return {
    async pauseRun(runId, access) {
      await requireAuthorizedRun(runId, "run:pause", access);
      const record = await store.requestPause(runId);
      await mailbox.publish({
        id: `control_pause_${Date.now()}`,
        runId,
        createdAt: new Date().toISOString(),
        kind: "control_signal",
        action: "pause",
        reason: "Pause requested via control plane",
      }).catch(() => undefined);
      return record;
    },

    async cancelRun(runId, access) {
      const run = await requireAuthorizedRun(runId, "run:cancel", access);
      if (run.status === "approval_required" && run.pendingApproval) {
        const ensured = await requirePendingApproval(runId);
        if (ensured.approval.status === "pending") {
          await resolveRunApproval(store, ensured.run, "canceled", {
            ...(access ? { access } : {}),
          });
        }
      }
      const record = await store.requestCancel(runId);
      await mailbox.publish({
        id: `control_cancel_${Date.now()}`,
        runId,
        createdAt: new Date().toISOString(),
        kind: "control_signal",
        action: "cancel",
        reason: "Cancel requested via control plane",
      }).catch(() => undefined);
      return record;
    },

    async getApproval(approvalId, access) {
      const approval = await store.getApproval(approvalId);
      if (!approval) {
        return undefined;
      }
      const run = await getCachedRun(approval.runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:read",
          runId: approval.runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: buildApprovalDetail(approval),
        }),
      );
      return approval;
    },

    async listApprovals(runId, access) {
      if (runId) {
        const run = await getCachedRun(runId);
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "approval:list",
            runId,
            ...(run ? { run } : {}),
            ...(access ? { access } : {}),
          }),
        );
        const approvals = await store.listApprovals(runId);
        return filterHarnessAuthorizedItems(approvals, authorize, access, (approval) =>
          buildAuthorizationRequest({
            action: "approval:read",
            runId: approval.runId,
            ...(run ? { run } : {}),
            detail: buildApprovalDetail(approval),
          }),
        );
      }

      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:list",
          ...(access ? { access } : {}),
        }),
      );
      const approvals = await store.listApprovals();
      return filterHarnessAuthorizedItems(approvals, authorize, access, async (approval) => {
        const run = await getCachedRun(approval.runId);
        return buildAuthorizationRequest({
          action: "approval:read",
          runId: approval.runId,
          ...(run ? { run } : {}),
          detail: buildApprovalDetail(approval),
        });
      });
    },

    async approveRun(runId, options?: HarnessApprovalResolutionOptions) {
      const { run, approval } = await requirePendingApproval(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:approve",
          runId,
          run,
          ...(options?.access ? { access: options.access } : {}),
          detail: buildApprovalDetail(approval),
        }),
      );
      const resolved = await resolveRunApproval(store, run, "approved", options);
      return resolved.approval;
    },

    async denyRun(runId, options?: HarnessApprovalResolutionOptions) {
      const { run, approval } = await requirePendingApproval(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:deny",
          runId,
          run,
          ...(options?.access ? { access: options.access } : {}),
          detail: buildApprovalDetail(approval),
        }),
      );
      const resolved = await resolveRunApproval(store, run, "denied", options);
      await store.requestCancel(runId);
      await mailbox.publish({
        id: `control_cancel_${Date.now()}`,
        runId,
        createdAt: new Date().toISOString(),
        kind: "control_signal",
        action: "cancel",
        reason: "Cancel requested via approval denial",
      }).catch(() => undefined);
      return resolved.approval;
    },

    async getRun(runId, access) {
      const run = await store.getRun(runId);
      if (!run) {
        return undefined;
      }
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:read",
          runId,
          run,
          ...(access ? { access } : {}),
        }),
      );
      return run;
    },

    async getCheckpoint(runId, access) {
      const checkpoint = await store.getCheckpoint(runId);
      if (!checkpoint) {
        return undefined;
      }
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "checkpoint:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return checkpoint.checkpoint;
    },

    async getSessionMemory(runId, access) {
      const sessionMemory = await contextKernel.getSessionMemory(runId);
      if (!sessionMemory) {
        return undefined;
      }
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "memory:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            kind: "session_memory",
          },
        }),
      );
      return sessionMemory;
    },

    async getLatestSummary(runId, access) {
      const summary = await contextKernel.getLatestSummary(runId);
      if (!summary) {
        return undefined;
      }
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "summary:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return summary;
    },

    async listSummaries(runId, access) {
      if (runId) {
        const run = await getCachedRun(runId);
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "summary:read",
            runId,
            ...(run ? { run } : {}),
            ...(access ? { access } : {}),
          }),
        );
        return contextKernel.listSummaries(runId);
      }

      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "summary:list",
          ...(access ? { access } : {}),
        }),
      );
      const summaries = await contextKernel.listSummaries();
      return filterHarnessAuthorizedItems(summaries, authorize, access, (summary) =>
        buildAuthorizationRequest({
          action: "summary:read",
          runId: summary.runId,
        }),
      );
    },

    async recallMemory(query, access) {
      const run = query.runId ? await getCachedRun(query.runId) : undefined;
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "memory:read",
          ...(query.runId ? { runId: query.runId } : {}),
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            query: query.query,
            ...(query.scopes ? { scopes: query.scopes } : {}),
            ...(query.kinds ? { kinds: query.kinds } : {}),
          },
        }),
      );
      const matches = await contextKernel.recallMemory(query);
      return filterHarnessAuthorizedItems(matches, authorize, access, (match) =>
        buildAuthorizationRequest({
          action: "memory:read",
          ...(match.runId ? { runId: match.runId } : {}),
        }),
      );
    },

    async assembleContext(runId, options, access) {
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "context:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          ...(options?.query ? { detail: { query: options.query } } : {}),
        }),
      );
      return contextKernel.assembleContext(runId, options);
    },

    async listRuns(access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:list",
          ...(access ? { access } : {}),
        }),
      );
      const runs = await store.listRuns();
      return filterHarnessAuthorizedItems(runs, authorize, access, (run) =>
        buildAuthorizationRequest({
          action: "run:read",
          runId: run.id,
          run,
        }),
      );
    },

    async getEvents(runId, access) {
      if (runId) {
        const run = await getCachedRun(runId);
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "event:read",
            runId,
            ...(run ? { run } : {}),
            ...(access ? { access } : {}),
          }),
        );
        return store.getEvents(runId);
      }

      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "event:list",
          ...(access ? { access } : {}),
        }),
      );
      const events = await store.getEvents();
      return filterHarnessAuthorizedItems(events, authorize, access, async (event) => {
        const run = await getCachedRun(event.runId);
        return buildAuthorizationRequest({
          action: "event:read",
          runId: event.runId,
          ...(run ? { run } : {}),
        });
      });
    },

    async getArtifacts(runId, access) {
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "artifact:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return store.getArtifacts(runId);
    },

    async getTasks(runId, access) {
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "task:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return store.getTasks(runId);
    },

    async getGraphNode(nodeId, access) {
      const node = await store.getGraphNode(nodeId);
      if (!node) {
        return undefined;
      }
      const run = node.runId ? await getCachedRun(node.runId) : undefined;
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:read",
          ...(node.runId ? { runId: node.runId } : {}),
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            nodeId: node.id,
            kind: node.kind,
          },
        }),
      );
      return node;
    },

    async listGraphNodes(query, access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:list",
          ...(query?.runId ? { runId: query.runId } : {}),
          ...(access ? { access } : {}),
          ...(query
            ? {
                detail: {
                  ...(query.kinds ? { kinds: query.kinds } : {}),
                  ...(query.scopes ? { scopes: query.scopes } : {}),
                },
              }
            : {}),
        }),
      );
      const nodes = await store.listGraphNodes(query);
      return filterHarnessAuthorizedItems(nodes, authorize, access, async (node) => {
        const run = node.runId ? await getCachedRun(node.runId) : undefined;
        return buildAuthorizationRequest({
          action: "graph:read",
          ...(node.runId ? { runId: node.runId } : {}),
          ...(run ? { run } : {}),
          detail: {
            nodeId: node.id,
            kind: node.kind,
          },
        });
      });
    },

    async listGraphEdges(query, access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:list",
          ...(query?.runId ? { runId: query.runId } : {}),
          ...(access ? { access } : {}),
        }),
      );
      const edges = await store.listGraphEdges(query);
      return filterHarnessAuthorizedItems(edges, authorize, access, async (edge) => {
        const run = edge.runId ? await getCachedRun(edge.runId) : undefined;
        return buildAuthorizationRequest({
          action: "graph:read",
          ...(edge.runId ? { runId: edge.runId } : {}),
          ...(run ? { run } : {}),
          detail: {
            edgeId: edge.id,
            kind: edge.kind,
          },
        });
      });
    },

    async getRunTimeline(runId, access) {
      const run = await getCachedRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            projection: "run_timeline",
          },
        }),
      );
      return projectRunTimeline(store, runId);
    },

    async getTaskBoard(query, access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:list",
          ...(query?.runId ? { runId: query.runId } : {}),
          ...(access ? { access } : {}),
          detail: {
            projection: "task_board",
          },
        }),
      );
      return projectTaskBoard(store, query);
    },

    async getApprovalInbox(query, access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:list",
          ...(query?.runId ? { runId: query.runId } : {}),
          ...(access ? { access } : {}),
          detail: {
            projection: "approval_inbox",
          },
        }),
      );
      return projectApprovalInbox(store, query);
    },

    async getArtifactFeed(query, access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "graph:list",
          ...(query?.runId ? { runId: query.runId } : {}),
          ...(access ? { access } : {}),
          detail: {
            projection: "artifact_feed",
          },
        }),
      );
      return projectArtifactFeed(store, query);
    },

    async replayRun(runId, access) {
      await requireAuthorizedRun(runId, "run:replay", access);
      return store.replayRun(runId);
    },

    getPaths(_access) {
      return store.paths;
    },
  };
}
