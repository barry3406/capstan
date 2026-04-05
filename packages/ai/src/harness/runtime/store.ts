import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  HarnessApprovalRecord,
  HarnessArtifactInput,
  HarnessArtifactRecord,
  HarnessContextArtifactRef,
  HarnessGraphEdgeQuery,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeQuery,
  HarnessGraphNodeRecord,
  HarnessMemoryInput,
  HarnessMemoryMatch,
  HarnessMemoryQuery,
  HarnessMemoryRecord,
  HarnessReplayReport,
  HarnessRunCheckpointRecord,
  HarnessRunEventRecord,
  HarnessRunEventType,
  HarnessRunRecord,
  HarnessRunStatus,
  HarnessRuntimePaths,
  HarnessRuntimeStore,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  HarnessTaskRecord,
} from "../types.js";
import type { AgentLoopCheckpoint, MemoryScope } from "../../types.js";
import { assertValidAgentLoopCheckpoint, assertValidCheckpointRecord } from "./checkpoint.js";
import {
  assertValidMemoryRecord,
  assertValidSessionMemoryRecord,
  assertValidSummaryRecord,
} from "./context-records.js";
import { assertValidApprovalRecord } from "./approval-records.js";
import { assertValidTaskRecord } from "./task-records.js";
import {
  buildArtifactGraphNode,
  buildApprovalGraphNode,
  buildMemoryGraphNode,
  buildRunApprovalEdge,
  buildRunArtifactEdge,
  buildRunGraphNode,
  buildRunMemoryEdge,
  buildRunTaskEdge,
  buildRunTurnEdge,
  buildTaskGraphNode,
  buildTurnGraphNode,
  FileHarnessGraphStore,
} from "../graph/index.js";

const HARNESS_ROOT = ".capstan/harness";

type StoreReadFile = (
  path: string,
  encoding: BufferEncoding | { encoding: BufferEncoding },
) => Promise<string>;

type StoreWriteFile = (
  path: string,
  data: string | Uint8Array,
  options?: string | { encoding?: BufferEncoding; flag?: string },
) => Promise<void>;

interface FileHarnessRuntimeStoreIO {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile: StoreReadFile;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  unlink(path: string): Promise<void>;
  writeFile: StoreWriteFile;
}

const defaultStoreIO: FileHarnessRuntimeStoreIO = {
  async mkdir(path, options) {
    await mkdir(path, options);
  },
  async readFile(path, encoding) {
    return (await readFile(path, encoding as BufferEncoding)) as string;
  },
  readdir,
  rename,
  stat,
  unlink,
  async writeFile(path, data, options) {
    await writeFile(path, data as string | Uint8Array, options as any);
  },
};

export function buildHarnessRuntimePaths(rootDir: string): HarnessRuntimePaths {
  const runtimeRoot = resolve(rootDir, HARNESS_ROOT);
  return {
    rootDir: runtimeRoot,
    runsDir: resolve(runtimeRoot, "runs"),
    eventsDir: resolve(runtimeRoot, "events"),
    mailboxDir: resolve(runtimeRoot, "mailbox"),
    globalEventsPath: resolve(runtimeRoot, "events.ndjson"),
    artifactsDir: resolve(runtimeRoot, "artifacts"),
    tasksDir: resolve(runtimeRoot, "tasks"),
    approvalsDir: resolve(runtimeRoot, "approvals"),
    checkpointsDir: resolve(runtimeRoot, "checkpoints"),
    summariesDir: resolve(runtimeRoot, "summaries"),
    sessionMemoryDir: resolve(runtimeRoot, "session-memory"),
    memoryDir: resolve(runtimeRoot, "memory"),
    graphDir: resolve(runtimeRoot, "graph"),
    graphNodesDir: resolve(runtimeRoot, "graph/nodes"),
    graphEdgesDir: resolve(runtimeRoot, "graph/edges"),
    sandboxesDir: resolve(runtimeRoot, "sandboxes"),
  };
}

export class FileHarnessRuntimeStore implements HarnessRuntimeStore {
  readonly paths: HarnessRuntimePaths;
  private readonly io: FileHarnessRuntimeStoreIO;
  private readonly graphStore: FileHarnessGraphStore;

  constructor(rootDir: string, io: FileHarnessRuntimeStoreIO = defaultStoreIO) {
    this.paths = buildHarnessRuntimePaths(rootDir);
    this.io = io;
    this.graphStore = new FileHarnessGraphStore(rootDir, io);
  }

  async initialize(): Promise<void> {
    await this.io.mkdir(this.paths.runsDir, { recursive: true });
    await this.io.mkdir(this.paths.eventsDir, { recursive: true });
    await this.io.mkdir(this.paths.mailboxDir, { recursive: true });
    await this.io.mkdir(this.paths.artifactsDir, { recursive: true });
    await this.io.mkdir(this.paths.tasksDir, { recursive: true });
    await this.io.mkdir(this.paths.approvalsDir, { recursive: true });
    await this.io.mkdir(this.paths.checkpointsDir, { recursive: true });
    await this.io.mkdir(this.paths.summariesDir, { recursive: true });
    await this.io.mkdir(this.paths.sessionMemoryDir, { recursive: true });
    await this.io.mkdir(this.paths.memoryDir, { recursive: true });
    await this.graphStore.initialize();
    await this.io.mkdir(this.paths.sandboxesDir, { recursive: true });
    await this.io.mkdir(dirname(this.paths.globalEventsPath), { recursive: true });
  }

  async persistRun(run: HarnessRunRecord): Promise<void> {
    await this.initialize();
    await writeJsonAtomic(
      resolve(this.paths.runsDir, `${run.id}.json`),
      toPersistableValue(run),
      this.io,
    );
    await this.syncRunGraph(run);
  }

  async getRun(runId: string): Promise<HarnessRunRecord | undefined> {
    return readJsonFile<HarnessRunRecord>(
      resolveRunScopedPath(this.paths.runsDir, runId, ".json"),
      this.io,
    );
  }

  async listRuns(): Promise<HarnessRunRecord[]> {
    await this.initialize();
    const entries = await this.io.readdir(this.paths.runsDir);
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readJsonFile<HarnessRunRecord>(resolve(this.paths.runsDir, entry), this.io),
        ),
    );
    return runs
      .filter((run): run is HarnessRunRecord => Boolean(run))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async appendEvent(event: HarnessRunEventRecord): Promise<void> {
    await this.initialize();
    const serialized = `${JSON.stringify(toPersistableValue(event))}\n`;
    await this.io.writeFile(this.paths.globalEventsPath, serialized, {
      encoding: "utf8",
      flag: "a",
    });
    await this.io.writeFile(resolve(this.paths.eventsDir, `${event.runId}.ndjson`), serialized, {
      encoding: "utf8",
      flag: "a",
    });
  }

  async getEvents(runId?: string): Promise<HarnessRunEventRecord[]> {
    await this.initialize();
    if (runId) {
      return readNdjsonFile<HarnessRunEventRecord>(
        resolveRunScopedPath(this.paths.eventsDir, runId, ".ndjson"),
        this.io,
      );
    }
    const events = await readNdjsonFile<HarnessRunEventRecord>(
      this.paths.globalEventsPath,
      this.io,
    );
    return events.sort((left, right) =>
      left.runId === right.runId
        ? left.sequence - right.sequence
        : left.timestamp - right.timestamp,
    );
  }

  async writeArtifact(runId: string, input: HarnessArtifactInput): Promise<HarnessArtifactRecord> {
    await this.initialize();
    const safeRunId = normalizeRunId(runId);
    const artifactId = `artifact_${randomUUID()}`;
    const artifactDir = resolve(this.paths.artifactsDir, safeRunId);
    await this.io.mkdir(artifactDir, { recursive: true });

    const normalized = normalizeArtifactPayload(input);
    const filename = buildArtifactFilename(artifactId, input.kind, input.filename, normalized.extension);
    const artifactPath = resolve(artifactDir, filename);

    await this.io.writeFile(artifactPath, normalized.content);

    const artifact: HarnessArtifactRecord = {
      id: artifactId,
      runId,
      kind: input.kind,
      path: artifactPath,
      createdAt: new Date().toISOString(),
      mimeType: normalized.mimeType,
      size: normalized.content.byteLength,
      ...(input.metadata ? { metadata: toPersistableValue(input.metadata) as Record<string, unknown> } : {}),
    };

    await this.io.writeFile(resolve(artifactDir, "index.ndjson"), `${JSON.stringify(artifact)}\n`, {
      encoding: "utf8",
      flag: "a",
    });

    const run = await this.getRun(runId);
    if (run) {
      await this.syncArtifactGraph(run, artifact);
    }

    return artifact;
  }

  async getArtifacts(runId: string): Promise<HarnessArtifactRecord[]> {
    await this.initialize();
    const artifactDir = resolveArtifactDir(this.paths.artifactsDir, runId);
    return readNdjsonFile<HarnessArtifactRecord>(
      resolve(artifactDir, "index.ndjson"),
      this.io,
    );
  }

  async persistTask(task: HarnessTaskRecord): Promise<void> {
    await this.initialize();
    const safeRunId = normalizeRunId(task.runId);
    assertValidTaskRecord(safeRunId, task);
    await writeJsonAtomic(taskRecordPath(this.paths.tasksDir, safeRunId, task.id), task, this.io);
    const run = await this.getRun(task.runId);
    if (run) {
      await this.syncTaskGraph(run, task);
    }
  }

  async patchTask(
    runId: string,
    taskId: string,
    patch: Partial<Omit<HarnessTaskRecord, "id" | "runId" | "createdAt">>,
  ): Promise<HarnessTaskRecord> {
    const safeRunId = normalizeRunId(runId);
    const safeTaskId = normalizeTaskId(taskId);
    const current = await readJsonFile<HarnessTaskRecord>(
      taskRecordPath(this.paths.tasksDir, safeRunId, safeTaskId),
      this.io,
    );
    if (!current) {
      throw new Error(`Harness run ${runId} task not found: ${taskId}`);
    }
    assertValidTaskRecord(safeRunId, current);
    const next: HarnessTaskRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    assertValidTaskRecord(safeRunId, next);
    await writeJsonAtomic(taskRecordPath(this.paths.tasksDir, safeRunId, safeTaskId), next, this.io);
    const run = await this.getRun(runId);
    if (run) {
      await this.syncTaskGraph(run, next);
    }
    return next;
  }

  async getTasks(runId: string): Promise<HarnessTaskRecord[]> {
    await this.initialize();
    const safeRunId = normalizeRunId(runId);
    const dirPath = resolve(this.paths.tasksDir, safeRunId);
    const entries = await this.io.readdir(dirPath).catch((error) => {
      if (isFileNotFound(error)) {
        return [] as string[];
      }
      throw error;
    });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonFile<HarnessTaskRecord>(resolve(dirPath, entry), this.io)),
    );
    return records
      .filter((record): record is HarnessTaskRecord => Boolean(record))
      .map((record) => {
        assertValidTaskRecord(safeRunId, record);
        return record;
      })
      .sort((left, right) =>
        left.order === right.order
          ? left.createdAt.localeCompare(right.createdAt)
          : left.order - right.order,
      );
  }

  async persistApproval(record: HarnessApprovalRecord): Promise<void> {
    await this.initialize();
    const safeApprovalId = normalizeApprovalId(record.id);
    const fallbackTimestamp = new Date().toISOString();
    const nextRecord: HarnessApprovalRecord = {
      ...record,
      ...(record.requestedAt ? {} : { requestedAt: fallbackTimestamp }),
      ...(record.updatedAt ? {} : { updatedAt: record.requestedAt ?? fallbackTimestamp }),
    };
    assertValidApprovalRecord(safeApprovalId, nextRecord);
    await writeJsonAtomic(
      approvalRecordPath(this.paths.approvalsDir, safeApprovalId),
      toPersistableValue(nextRecord),
      this.io,
    );
    const run = await this.getRun(nextRecord.runId);
    if (run) {
      await this.syncApprovalGraph(run, nextRecord);
    }
  }

  async getApproval(approvalId: string): Promise<HarnessApprovalRecord | undefined> {
    const safeApprovalId = normalizeApprovalId(approvalId);
    const record = await readJsonFile<HarnessApprovalRecord>(
      approvalRecordPath(this.paths.approvalsDir, safeApprovalId),
      this.io,
    );
    if (!record) {
      return undefined;
    }
    assertValidApprovalRecord(safeApprovalId, record);
    return record;
  }

  async listApprovals(runId?: string): Promise<HarnessApprovalRecord[]> {
    await this.initialize();
    const entries = await this.io.readdir(this.paths.approvalsDir).catch((error) => {
      if (isFileNotFound(error)) {
        return [] as string[];
      }
      throw error;
    });
    const approvals = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readJsonFile<HarnessApprovalRecord>(resolve(this.paths.approvalsDir, entry), this.io),
        ),
    );
    return approvals
      .filter((record): record is HarnessApprovalRecord => Boolean(record))
      .map((record) => {
        assertValidApprovalRecord(record.id, record);
        return record;
      })
      .filter((record) => (runId ? record.runId === normalizeRunId(runId) : true))
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  async patchApproval(
    approvalId: string,
    patch: Partial<Omit<HarnessApprovalRecord, "id" | "runId" | "requestedAt">>,
  ): Promise<HarnessApprovalRecord> {
    const safeApprovalId = normalizeApprovalId(approvalId);
    const current = await this.getApproval(safeApprovalId);
    if (!current) {
      throw new Error(`Harness approval not found: ${approvalId}`);
    }
    const next: HarnessApprovalRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    assertValidApprovalRecord(safeApprovalId, next);
    await writeJsonAtomic(
      approvalRecordPath(this.paths.approvalsDir, safeApprovalId),
      toPersistableValue(next),
      this.io,
    );
    const run = await this.getRun(next.runId);
    if (run) {
      await this.syncApprovalGraph(run, next);
    }
    return next;
  }

  async persistCheckpoint(runId: string, checkpoint: AgentLoopCheckpoint): Promise<HarnessRunCheckpointRecord> {
    await this.initialize();
    assertValidAgentLoopCheckpoint(
      checkpoint,
      `Harness run ${runId} checkpoint`,
    );
    const record: HarnessRunCheckpointRecord = {
      runId: normalizeRunId(runId),
      updatedAt: new Date().toISOString(),
      checkpoint: toPersistableValue(checkpoint) as AgentLoopCheckpoint,
    };
    await writeJsonAtomic(
      resolveRunScopedPath(this.paths.checkpointsDir, runId, ".json"),
      record,
      this.io,
    );
    const run = await this.getRun(runId);
    if (run) {
      await this.syncTurnGraph(run, record);
    }
    return record;
  }

  async getCheckpoint(runId: string): Promise<HarnessRunCheckpointRecord | undefined> {
    const record = await readJsonFile<HarnessRunCheckpointRecord>(
      resolveRunScopedPath(this.paths.checkpointsDir, runId, ".json"),
      this.io,
    );
    if (!record) {
      return undefined;
    }
    assertValidCheckpointRecord(normalizeRunId(runId), record);
    return record;
  }

  async persistSessionMemory(record: HarnessSessionMemoryRecord): Promise<void> {
    await this.initialize();
    const safeRunId = normalizeRunId(record.runId);
    assertValidSessionMemoryRecord(safeRunId, record);
    await writeJsonAtomic(
      resolve(this.paths.sessionMemoryDir, `${safeRunId}.json`),
      toPersistableValue(record),
      this.io,
    );
    const run = await this.getRun(record.runId);
    if (run) {
      await this.syncSessionMemoryGraph(run, record);
    }
  }

  async getSessionMemory(runId: string): Promise<HarnessSessionMemoryRecord | undefined> {
    const record = await readJsonFile<HarnessSessionMemoryRecord>(
      resolveRunScopedPath(this.paths.sessionMemoryDir, runId, ".json"),
      this.io,
    );
    if (!record) {
      return undefined;
    }
    assertValidSessionMemoryRecord(normalizeRunId(runId), record);
    return record;
  }

  async persistSummary(record: HarnessSummaryRecord): Promise<void> {
    await this.initialize();
    assertValidSummaryRecord(normalizeRunId(record.runId), record);
    await writeJsonAtomic(
      resolveRunScopedPath(this.paths.summariesDir, record.runId, ".json"),
      toPersistableValue(record),
      this.io,
    );
    const run = await this.getRun(record.runId);
    if (run) {
      await this.syncSummaryGraph(run, record);
    }
  }

  async getLatestSummary(runId: string): Promise<HarnessSummaryRecord | undefined> {
    const record = await readJsonFile<HarnessSummaryRecord>(
      resolveRunScopedPath(this.paths.summariesDir, runId, ".json"),
      this.io,
    );
    if (!record) {
      return undefined;
    }
    assertValidSummaryRecord(normalizeRunId(runId), record);
    return record;
  }

  async listSummaries(runId?: string): Promise<HarnessSummaryRecord[]> {
    await this.initialize();
    if (runId) {
      const summary = await this.getLatestSummary(runId);
      return summary ? [summary] : [];
    }

    const entries = await this.io.readdir(this.paths.summariesDir);
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readJsonFile<HarnessSummaryRecord>(resolve(this.paths.summariesDir, entry), this.io),
        ),
    );
    return summaries
      .filter((record): record is HarnessSummaryRecord => Boolean(record))
      .map((record) => {
        assertValidSummaryRecord(record.runId, record);
        return record;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async rememberMemory(input: HarnessMemoryInput): Promise<HarnessMemoryRecord> {
    await this.initialize();

    const normalizedContent = normalizeMemoryContent(input.content);
    if (!normalizedContent) {
      throw new Error("Harness memory content must be a non-empty string");
    }

    const normalizedScope = {
      type: input.scope.type.trim(),
      id: input.scope.id.trim(),
    };
    const normalizedMetadata = input.metadata
      ? (toPersistableValue(input.metadata) as Record<string, unknown>)
      : undefined;
    const normalizedGraphScopes = input.graphScopes?.length
      ? (toPersistableValue(input.graphScopes) as HarnessMemoryRecord["graphScopes"])
      : undefined;
    const existing = (await this.readAllMemoryRecords([normalizedScope])).find((record) =>
      record.scope.type === normalizedScope.type &&
      record.scope.id === normalizedScope.id &&
      record.kind === (input.kind ?? "fact") &&
      (
        (
          (input.kind ?? "fact") === "summary" &&
          input.runId != null &&
          record.runId === input.runId
        ) ||
        normalizeMemoryContent(record.content) === normalizedContent
      ),
    );

    const now = new Date().toISOString();
    const record: HarnessMemoryRecord = existing
      ? {
          ...existing,
          updatedAt: now,
          content: input.content.trim(),
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.sourceSummaryId ? { sourceSummaryId: input.sourceSummaryId } : {}),
          ...(input.importance ? { importance: input.importance } : {}),
          ...(normalizedGraphScopes ? { graphScopes: normalizedGraphScopes } : {}),
          ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
        }
      : {
          id: `mem_${randomUUID()}`,
          scope: toPersistableValue(normalizedScope) as HarnessMemoryRecord["scope"],
          kind: input.kind ?? "fact",
          content: input.content.trim(),
          createdAt: now,
          updatedAt: now,
          accessCount: 0,
          lastAccessedAt: now,
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.sourceSummaryId ? { sourceSummaryId: input.sourceSummaryId } : {}),
          ...(input.importance ? { importance: input.importance } : {}),
          ...(normalizedGraphScopes ? { graphScopes: normalizedGraphScopes } : {}),
          ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
        };

    await writeJsonAtomic(memoryRecordPath(this.paths.memoryDir, record), record, this.io);
    const run = record.runId ? await this.getRun(record.runId) : undefined;
    await this.syncMemoryGraph(run, record);
    return record;
  }

  async recallMemory(query: HarnessMemoryQuery): Promise<HarnessMemoryMatch[]> {
    const all = await this.readAllMemoryRecords(query.scopes);
    const filtered = all.filter((record) => {
      if (query.kinds?.length && !query.kinds.includes(record.kind)) {
        return false;
      }
      if (query.runId && record.runId !== query.runId) {
        return false;
      }
      return true;
    });

    const scored = filtered
      .map((record) => ({
        ...record,
        score: scoreMemoryMatch(record, query.query),
      }))
      .filter((record) => record.score >= (query.minScore ?? 0))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, query.limit ?? 8);

    const touched = await Promise.all(scored.map((record) => this.touchMemory(record)));
    return touched.map((record) => ({
      ...record,
      score: scoreMemoryMatch(record, query.query),
    }));
  }

  async readArtifactPreview(
    artifact: HarnessArtifactRecord,
    maxChars: number,
  ): Promise<string | undefined> {
    if (!isPreviewableArtifact(artifact)) {
      return undefined;
    }

    try {
      const source = await this.io.readFile(artifact.path, "utf8");
      return source.length > maxChars
        ? `${source.slice(0, maxChars)}... (truncated)`
        : source;
    } catch {
      return undefined;
    }
  }

  async patchRun(
    runId: string,
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
  ): Promise<HarnessRunRecord> {
    const run = await this.requireRun(runId);
    const nextRun: HarnessRunRecord = {
      ...run,
      ...patch,
      updatedAt: new Date().toISOString(),
      lastEventSequence: patch.lastEventSequence ?? run.lastEventSequence,
    };
    await this.persistRun(nextRun);
    return nextRun;
  }

  async transitionRun(
    runId: string,
    type: HarnessRunEventType,
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
    data: Record<string, unknown>,
  ): Promise<HarnessRunRecord> {
    const run = await this.requireRun(runId);
    const timestamp = Date.now();
    const event: HarnessRunEventRecord = {
      id: `evt_${randomUUID()}`,
      runId: run.id,
      sequence: run.lastEventSequence + 1,
      type,
      timestamp,
      data: toPersistableValue(data) as Record<string, unknown>,
    };

    await this.appendEvent(event);

    const nextRun: HarnessRunRecord = {
      ...run,
      ...patch,
      updatedAt: new Date(timestamp).toISOString(),
      lastEventSequence: event.sequence,
    };
    await this.persistRun(nextRun);
    return nextRun;
  }

  async requestPause(runId: string): Promise<HarnessRunRecord> {
    const run = await this.requireRun(runId);
    if (run.control?.pauseRequestedAt || run.status === "paused") {
      return run;
    }
    if (run.status !== "running") {
      throw new Error(`Cannot pause run ${runId} from status ${run.status}`);
    }

    const requestedAt = new Date().toISOString();
    return this.transitionRun(
      runId,
      "pause_requested",
      {
        status: "pause_requested",
        control: {
          ...run.control,
          pauseRequestedAt: requestedAt,
        },
      },
      { requestedAt },
    );
  }

  async requestCancel(runId: string): Promise<HarnessRunRecord> {
    const run = await this.requireRun(runId);
    if (run.control?.cancelRequestedAt || run.status === "canceled") {
      return run;
    }

    const requestedAt = new Date().toISOString();

    if (run.status === "paused" || run.status === "approval_required") {
      const canceledRun = await this.transitionRun(
        runId,
        "run_canceled",
        {
          status: "canceled",
          pendingApprovalId: undefined,
          pendingApproval: undefined,
          control: {
            ...run.control,
            cancelRequestedAt: requestedAt,
          },
        },
        { requestedAt, previousStatus: run.status },
      );
      if (run.pendingApprovalId) {
        const approval = await this.getApproval(run.pendingApprovalId).catch(() => undefined);
        if (approval?.status === "pending") {
          await this.patchApproval(run.pendingApprovalId, {
            status: "canceled",
            resolvedAt: requestedAt,
          }).catch(() => undefined);
        }
      }
      return canceledRun;
    }

    if (run.status !== "running" && run.status !== "pause_requested") {
      throw new Error(`Cannot cancel run ${runId} from status ${run.status}`);
    }

    return this.transitionRun(
      runId,
      "cancel_requested",
      {
        status: "cancel_requested",
        control: {
          ...run.control,
          cancelRequestedAt: requestedAt,
        },
      },
      { requestedAt },
    );
  }

  async replayRun(runId: string): Promise<HarnessReplayReport> {
    const stored = await this.getRun(runId);
    const events = await this.getEvents(runId);

    const derived = deriveRunFromEvents(events);

    return {
      runId,
      consistent: stored
        ? stored.status === derived.status &&
          stored.iterations === derived.iterations &&
          stored.toolCalls === derived.toolCalls &&
          stored.taskCalls === derived.taskCalls &&
          stored.artifactIds.length === derived.artifactCount
        : false,
      eventCount: events.length,
      ...(derived.status ? { derivedStatus: derived.status } : {}),
      ...(stored ? { storedStatus: stored.status } : {}),
      derivedIterations: derived.iterations,
      ...(stored ? { storedIterations: stored.iterations } : {}),
      derivedToolCalls: derived.toolCalls,
      ...(stored ? { storedToolCalls: stored.toolCalls } : {}),
      derivedTaskCalls: derived.taskCalls,
      ...(stored ? { storedTaskCalls: stored.taskCalls } : {}),
      derivedArtifactCount: derived.artifactCount,
      ...(stored ? { storedArtifactCount: stored.artifactIds.length } : {}),
    };
  }

  async clearRunArtifacts(runId: string): Promise<void> {
    const artifacts = await this.getArtifacts(runId);
    await Promise.all(
      artifacts.map(async (artifact) => {
        try {
          await this.io.unlink(artifact.path);
        } catch {
          // Ignore already-removed files.
        }
      }),
    );
  }

  async requireRun(runId: string): Promise<HarnessRunRecord> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Harness run not found: ${runId}`);
    }
    return run;
  }

  async upsertGraphNode(node: HarnessGraphNodeRecord): Promise<void> {
    await this.graphStore.upsertNode(node);
  }

  async getGraphNode(nodeId: string): Promise<HarnessGraphNodeRecord | undefined> {
    return this.graphStore.getNode(nodeId);
  }

  async listGraphNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]> {
    return this.graphStore.listNodes({
      ...(query?.scopes?.length ? { scopes: query.scopes } : {}),
      ...(query?.kinds?.length ? { kinds: query.kinds } : {}),
      ...(query?.ids?.length ? { ids: query.ids } : {}),
      ...(query?.runId ? { runId: query.runId } : {}),
    });
  }

  async upsertGraphEdge(edge: HarnessGraphEdgeRecord): Promise<void> {
    await this.graphStore.upsertEdge(edge);
  }

  async listGraphEdges(query?: HarnessGraphEdgeQuery): Promise<HarnessGraphEdgeRecord[]> {
    return this.graphStore.listEdges({
      ...(query?.scopes?.length ? { scopes: query.scopes } : {}),
      ...(query?.kinds?.length ? { kinds: query.kinds } : {}),
      ...(query?.ids?.length ? { ids: query.ids } : {}),
      ...(query?.fromIds?.length ? { fromIds: query.fromIds } : {}),
      ...(query?.toIds?.length ? { toIds: query.toIds } : {}),
      ...(query?.runId ? { runId: query.runId } : {}),
    });
  }

  private async syncRunGraph(run: HarnessRunRecord): Promise<void> {
    await this.graphStore.upsertNode(buildRunGraphNode(this.paths, run));
  }

  private async syncTurnGraph(
    run: HarnessRunRecord,
    record: HarnessRunCheckpointRecord,
  ): Promise<void> {
    const turnNode = buildTurnGraphNode(this.paths, run, record.checkpoint, record.updatedAt);
    await this.graphStore.upsertNode(turnNode);
    await this.graphStore.upsertEdge(buildRunTurnEdge(run, turnNode.id, record.updatedAt));
  }

  private async syncTaskGraph(
    run: HarnessRunRecord,
    task: HarnessTaskRecord,
  ): Promise<void> {
    await this.graphStore.upsertNode(buildTaskGraphNode(this.paths, task));
    await this.graphStore.upsertEdge(buildRunTaskEdge(run, task));
  }

  private async syncArtifactGraph(
    run: HarnessRunRecord,
    artifact: HarnessArtifactRecord,
  ): Promise<void> {
    await this.graphStore.upsertNode(buildArtifactGraphNode(this.paths, artifact));
    await this.graphStore.upsertEdge(buildRunArtifactEdge(run, artifact));
  }

  private async syncApprovalGraph(
    run: HarnessRunRecord,
    approval: HarnessApprovalRecord,
  ): Promise<void> {
    await this.graphStore.upsertNode(buildApprovalGraphNode(this.paths, approval));
    await this.graphStore.upsertEdge(buildRunApprovalEdge(run, approval));
  }

  private async syncSessionMemoryGraph(
    run: HarnessRunRecord,
    record: HarnessSessionMemoryRecord,
  ): Promise<void> {
    const node = buildMemoryGraphNode(this.paths, run, record, "session_memory");
    await this.graphStore.upsertNode(node);
    await this.graphStore.upsertEdge(buildRunMemoryEdge(run, node.id, record.updatedAt, "session_memory"));
  }

  private async syncSummaryGraph(
    run: HarnessRunRecord,
    record: HarnessSummaryRecord,
  ): Promise<void> {
    const node = buildMemoryGraphNode(this.paths, run, record, "summary");
    await this.graphStore.upsertNode(node);
    await this.graphStore.upsertEdge(buildRunMemoryEdge(run, node.id, record.updatedAt, "summary"));
  }

  private async syncMemoryGraph(
    run: HarnessRunRecord | undefined,
    record: HarnessMemoryRecord,
  ): Promise<void> {
    const node = buildMemoryGraphNode(this.paths, run, record, "memory");
    await this.graphStore.upsertNode(node);
    if (run) {
      await this.graphStore.upsertEdge(buildRunMemoryEdge(run, node.id, record.updatedAt, "memory"));
    }
  }

  private async readAllMemoryRecords(scopes?: MemoryScope[]): Promise<HarnessMemoryRecord[]> {
    await this.initialize();

    const scopeDirs = scopes?.length
      ? scopes.map((scope) => encodeMemoryScope(scope))
      : await this.io.readdir(this.paths.memoryDir).catch((error) => {
          if (isFileNotFound(error)) {
            return [] as string[];
          }
          throw error;
        });

    const records = await Promise.all(
      scopeDirs.map(async (scopeDir) => {
        const dirPath = resolve(this.paths.memoryDir, scopeDir);
        const entries = await this.io.readdir(dirPath).catch((error) => {
          if (isFileNotFound(error)) {
            return [] as string[];
          }
          throw error;
        });

        const scopeRecords = await Promise.all(
          entries
            .filter((entry) => entry.endsWith(".json"))
            .map((entry) =>
              readJsonFile<HarnessMemoryRecord>(resolve(dirPath, entry), this.io),
            ),
        );

        return scopeRecords
          .filter((record): record is HarnessMemoryRecord => Boolean(record))
          .map((record) => {
            const normalized = normalizeStoredMemoryRecord(record);
            assertValidMemoryRecord(normalized, `Harness memory record ${normalized.id}`);
            return normalized;
          });
      }),
    );

    return records.flat();
  }

  private async touchMemory(record: HarnessMemoryRecord): Promise<HarnessMemoryRecord> {
    const touched: HarnessMemoryRecord = {
      ...record,
      accessCount: record.accessCount + 1,
      lastAccessedAt: new Date().toISOString(),
      updatedAt: record.updatedAt,
    };
    await writeJsonAtomic(memoryRecordPath(this.paths.memoryDir, touched), touched, this.io);
    return touched;
  }
}

function normalizeStoredMemoryRecord(
  record: HarnessMemoryRecord,
): HarnessMemoryRecord {
  const metadataGraphScopes =
    Array.isArray(record.metadata?.graphScopes)
      ? (toPersistableValue(record.metadata.graphScopes) as HarnessMemoryRecord["graphScopes"])
      : undefined;
  const graphScopes = record.graphScopes?.length
    ? record.graphScopes
    : metadataGraphScopes;
  if (!graphScopes?.length) {
    return record;
  }

  const metadata = record.metadata
    ? Object.fromEntries(
        Object.entries(record.metadata).filter(([key]) => key !== "graphScopes"),
      )
    : undefined;
  return {
    ...record,
    graphScopes,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(metadata && Object.keys(metadata).length === 0 ? { metadata: undefined } : {}),
  };
}

async function readJsonFile<T>(
  path: string,
  io: Pick<FileHarnessRuntimeStoreIO, "readFile">,
): Promise<T | undefined> {
  try {
    const source = await io.readFile(path, "utf8");
    return JSON.parse(source) as T;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readNdjsonFile<T>(
  path: string,
  io: Pick<FileHarnessRuntimeStoreIO, "readFile">,
): Promise<T[]> {
  try {
    const source = await io.readFile(path, "utf8");
    return source
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (isFileNotFound(error)) {
      return [];
    }
    throw error;
  }
}

function resolveRunScopedPath(baseDir: string, runId: string, extension: string): string {
  return resolve(baseDir, `${normalizeRunId(runId)}${extension}`);
}

function resolveArtifactDir(baseDir: string, runId: string): string {
  return resolve(baseDir, normalizeRunId(runId));
}

function approvalRecordPath(baseDir: string, approvalId: string): string {
  return resolve(baseDir, `${normalizeApprovalId(approvalId)}.json`);
}

function encodeMemoryScope(scope: MemoryScope): string {
  const namespace = encodeMemoryScopeSegment(scope.type.trim().toLowerCase());
  const id = encodeMemoryScopeSegment(scope.id.trim().toLowerCase());
  return `${namespace}__${id}`;
}

function encodeMemoryScopeSegment(value: string): string {
  const normalized = value.replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  if (normalized.length <= 96) {
    return normalized;
  }
  const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 16);
  const prefix = normalized.slice(0, 78).replace(/-+$/g, "");
  return `${prefix || "scope"}--${digest}`;
}

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function memoryRecordPath(baseDir: string, record: Pick<HarnessMemoryRecord, "scope" | "id">): string {
  return resolve(baseDir, encodeMemoryScope(record.scope), `${record.id}.json`);
}

function taskRecordPath(baseDir: string, runId: string, taskId: string): string {
  return resolve(baseDir, normalizeRunId(runId), `${normalizeTaskId(taskId)}.json`);
}

function normalizeRunId(runId: string): string {
  const normalized = runId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid harness run id: ${runId}`);
  }
  return normalized;
}

function normalizeTaskId(taskId: string): string {
  const normalized = taskId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid harness task id: ${taskId}`);
  }
  return normalized;
}

function normalizeApprovalId(approvalId: string): string {
  const normalized = approvalId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid harness approval id: ${approvalId}`);
  }
  return normalized;
}

function isFileNotFound(error: unknown): boolean {
  return (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function writeJsonAtomic(
  path: string,
  value: unknown,
  io: Pick<FileHarnessRuntimeStoreIO, "mkdir" | "writeFile" | "rename">,
): Promise<void> {
  await io.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await io.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await io.rename(tempPath, path);
}

function normalizeArtifactPayload(input: HarnessArtifactInput): {
  content: Buffer;
  extension: string;
  mimeType: string;
} {
  if (Buffer.isBuffer(input.content)) {
    return {
      content: input.content,
      extension: normalizeExtension(input.extension ?? extensionForKind(input.kind) ?? ".bin"),
      mimeType: input.mimeType ?? mimeTypeForExtension(input.extension ?? extensionForKind(input.kind) ?? ".bin"),
    };
  }

  if (input.content instanceof Uint8Array) {
    return {
      content: Buffer.from(input.content),
      extension: normalizeExtension(input.extension ?? extensionForKind(input.kind) ?? ".bin"),
      mimeType: input.mimeType ?? mimeTypeForExtension(input.extension ?? extensionForKind(input.kind) ?? ".bin"),
    };
  }

  if (typeof input.content === "string") {
    const extension = normalizeExtension(input.extension ?? ".txt");
    return {
      content: Buffer.from(input.content, "utf8"),
      extension,
      mimeType: input.mimeType ?? mimeTypeForExtension(extension),
    };
  }

  const extension = normalizeExtension(input.extension ?? ".json");
  return {
    content: Buffer.from(JSON.stringify(toPersistableValue(input.content), null, 2), "utf8"),
    extension,
    mimeType: input.mimeType ?? "application/json",
  };
}

function buildArtifactFilename(
  artifactId: string,
  kind: string,
  filename: string | undefined,
  extension: string,
): string {
  const base = sanitizeArtifactName(filename ?? (kind || "artifact"));
  return `${artifactId}-${base}${normalizeExtension(extension)}`;
}

function sanitizeArtifactName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 80) || "artifact";
}

function normalizeExtension(extension: string): string {
  return extension.startsWith(".") ? extension : `.${extension}`;
}

function extensionForKind(kind: string): string | undefined {
  switch (kind) {
    case "screenshot":
      return ".png";
    case "json":
      return ".json";
    default:
      return undefined;
  }
}

function isPreviewableArtifact(artifact: HarnessArtifactRecord): boolean {
  return (
    artifact.mimeType.startsWith("text/") ||
    artifact.mimeType === "application/json"
  );
}

function scoreMemoryMatch(record: HarnessMemoryRecord, query: string): number {
  const haystack = [
    record.kind,
    record.content,
    record.metadata ? JSON.stringify(record.metadata) : "",
  ]
    .join("\n")
    .toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return 0;
  }

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  const importanceBoost =
    record.importance === "critical"
      ? 0.4
      : record.importance === "high"
        ? 0.25
        : record.importance === "medium"
          ? 0.1
          : 0;

  const freshnessBoost = Math.max(
    0,
    0.2 - (Date.now() - new Date(record.updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 180),
  );

  return score / terms.length + importanceBoost + freshnessBoost;
}

function mimeTypeForExtension(extension: string): string {
  switch (normalizeExtension(extension)) {
    case ".png":
      return "image/png";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function deriveRunFromEvents(events: HarnessRunEventRecord[]): {
  status?: HarnessRunStatus;
  iterations: number;
  toolCalls: number;
  taskCalls: number;
  artifactCount: number;
} {
  let status: HarnessRunStatus | undefined;
  let iterations = 0;
  let toolCalls = 0;
  let taskCalls = 0;
  let artifactCount = 0;

  for (const event of events) {
    switch (event.type) {
      case "run_started":
      case "run_resumed":
        status = "running";
        break;
      case "tool_result":
        toolCalls++;
        break;
      case "artifact_created":
        artifactCount++;
        break;
      case "task_result":
        taskCalls++;
        break;
      case "pause_requested":
        status = "pause_requested";
        break;
      case "run_paused":
        status = "paused";
        iterations = readNumericField(event.data, "iterations", iterations);
        break;
      case "cancel_requested":
        status = "cancel_requested";
        break;
      case "run_canceled":
        status = "canceled";
        iterations = readNumericField(event.data, "iterations", iterations);
        break;
      case "approval_required":
        status = "approval_required";
        iterations = readNumericField(event.data, "iterations", iterations);
        break;
      case "approval_approved":
      case "approval_denied":
        status = "approval_required";
        break;
      case "run_completed":
        status = "completed";
        iterations = readNumericField(event.data, "iterations", iterations);
        break;
      case "run_max_iterations":
        status = "max_iterations";
        iterations = readNumericField(event.data, "iterations", iterations);
        break;
      case "run_failed":
        status = "failed";
        iterations = readNumericField(event.data, "iterations", iterations);
        break;
    }
  }

  return {
    ...(status ? { status } : {}),
    iterations,
    toolCalls,
    taskCalls,
    artifactCount,
  };
}

function readNumericField(
  data: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  return typeof data[key] === "number" ? (data[key] as number) : fallback;
}

function toPersistableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: "buffer",
      encoding: "base64",
      data: value.toString("base64"),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => toPersistableValue(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "undefined" || typeof entry === "function") continue;
      out[key] = toPersistableValue(entry);
    }
    return out;
  }

  return value;
}
