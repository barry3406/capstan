import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  HarnessArtifactInput,
  HarnessArtifactRecord,
  HarnessContextArtifactRef,
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
} from "../types.js";
import type { AgentLoopCheckpoint, MemoryScope } from "../../types.js";
import { assertValidAgentLoopCheckpoint, assertValidCheckpointRecord } from "./checkpoint.js";
import {
  assertValidMemoryRecord,
  assertValidSessionMemoryRecord,
  assertValidSummaryRecord,
} from "./context-records.js";

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
    globalEventsPath: resolve(runtimeRoot, "events.ndjson"),
    artifactsDir: resolve(runtimeRoot, "artifacts"),
    checkpointsDir: resolve(runtimeRoot, "checkpoints"),
    summariesDir: resolve(runtimeRoot, "summaries"),
    sessionMemoryDir: resolve(runtimeRoot, "session-memory"),
    memoryDir: resolve(runtimeRoot, "memory"),
    sandboxesDir: resolve(runtimeRoot, "sandboxes"),
  };
}

export class FileHarnessRuntimeStore implements HarnessRuntimeStore {
  readonly paths: HarnessRuntimePaths;
  private readonly io: FileHarnessRuntimeStoreIO;

  constructor(rootDir: string, io: FileHarnessRuntimeStoreIO = defaultStoreIO) {
    this.paths = buildHarnessRuntimePaths(rootDir);
    this.io = io;
  }

  async initialize(): Promise<void> {
    await this.io.mkdir(this.paths.runsDir, { recursive: true });
    await this.io.mkdir(this.paths.eventsDir, { recursive: true });
    await this.io.mkdir(this.paths.artifactsDir, { recursive: true });
    await this.io.mkdir(this.paths.checkpointsDir, { recursive: true });
    await this.io.mkdir(this.paths.summariesDir, { recursive: true });
    await this.io.mkdir(this.paths.sessionMemoryDir, { recursive: true });
    await this.io.mkdir(this.paths.memoryDir, { recursive: true });
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
          ...(input.metadata
            ? {
                metadata: toPersistableValue(input.metadata) as Record<string, unknown>,
              }
            : {}),
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
          ...(input.metadata
            ? {
                metadata: toPersistableValue(input.metadata) as Record<string, unknown>,
              }
            : {}),
        };

    await writeJsonAtomic(memoryRecordPath(this.paths.memoryDir, record), record, this.io);
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
      return this.transitionRun(
        runId,
        "run_canceled",
        {
          status: "canceled",
          pendingApproval: undefined,
          control: {
            ...run.control,
            cancelRequestedAt: requestedAt,
          },
        },
        { requestedAt, previousStatus: run.status },
      );
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
          stored.artifactIds.length === derived.artifactCount
        : false,
      eventCount: events.length,
      ...(derived.status ? { derivedStatus: derived.status } : {}),
      ...(stored ? { storedStatus: stored.status } : {}),
      derivedIterations: derived.iterations,
      ...(stored ? { storedIterations: stored.iterations } : {}),
      derivedToolCalls: derived.toolCalls,
      ...(stored ? { storedToolCalls: stored.toolCalls } : {}),
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
            assertValidMemoryRecord(record, `Harness memory record ${record.id}`);
            return record;
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

function encodeMemoryScope(scope: MemoryScope): string {
  const namespace = scope.type.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const id = scope.id.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `${namespace}__${id}`;
}

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function memoryRecordPath(baseDir: string, record: Pick<HarnessMemoryRecord, "scope" | "id">): string {
  return resolve(baseDir, encodeMemoryScope(record.scope), `${record.id}.json`);
}

function normalizeRunId(runId: string): string {
  const normalized = runId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid harness run id: ${runId}`);
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
  artifactCount: number;
} {
  let status: HarnessRunStatus | undefined;
  let iterations = 0;
  let toolCalls = 0;
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
