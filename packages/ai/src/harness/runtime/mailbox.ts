import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  AgentLoopMailbox,
  AgentLoopMailboxMessage,
} from "../../types.js";
import type { HarnessRuntimePaths } from "../types.js";

interface MailboxState {
  nextWriteSequence: number;
  nextReadSequence: number;
}

interface NotificationWaiter {
  resolve(message: AgentLoopMailboxMessage | undefined): void;
  reject(error: Error): void;
  clearTimer(): void;
}

export class FileHarnessRunMailbox implements AgentLoopMailbox {
  private readonly waiters = new Map<string, NotificationWaiter[]>();
  private readonly states = new Map<string, MailboxState>();
  private readonly initializedRuns = new Set<string>();

  constructor(private readonly paths: HarnessRuntimePaths) {}

  async publish(message: AgentLoopMailboxMessage): Promise<void> {
    const runId = normalizeRunId(message.runId);
    await this.withRunLock(runId, async (runDir) => {
      const state = this.requireState(runId);
      const sequence = state.nextWriteSequence++;
      const targetPath = resolve(runDir, `${sequence.toString().padStart(12, "0")}.json`);
      await writeJsonAtomic(targetPath, message);
      await this.persistState(runId, runDir);
    });

    const waiters = this.waiters.get(runId);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift()!;
      const next = await this.readNextSynchronized(runId);
      waiter.resolve(next);
    }
  }

  async next(
    runId: string,
    options?: {
      timeoutMs?: number;
    },
  ): Promise<AgentLoopMailboxMessage | undefined> {
    const safeRunId = normalizeRunId(runId);
    const immediate = await this.readNextSynchronized(safeRunId);
    if (immediate) {
      return immediate;
    }
    if (options?.timeoutMs === 0) {
      return undefined;
    }

    return new Promise<AgentLoopMailboxMessage | undefined>((resolve, reject) => {
      const waiters = this.waiters.get(safeRunId) ?? [];
      this.waiters.set(safeRunId, waiters);
      const waiter = createNotificationWaiter({
        resolve,
        reject,
        ...(options?.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
        onTimeout: () => {
          this.removeWaiter(safeRunId, waiter);
          resolve(undefined);
        },
      });
      waiters.push(waiter);
    });
  }

  async list(runId: string): Promise<AgentLoopMailboxMessage[]> {
    const safeRunId = normalizeRunId(runId);
    return this.withRunLock(safeRunId, async (runDir) => {
      const entries = await readdir(runDir).catch((error) => {
        if (isFileNotFound(error)) {
          return [] as string[];
        }
        throw error;
      });
      return Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json") && entry !== "state.json")
          .sort()
          .map(async (entry) => {
            const content = await readFile(resolve(runDir, entry), "utf8");
            return parseMailboxMessage(content, safeRunId, entry);
          }),
      );
    });
  }

  private async ensureRunReady(runId: string): Promise<string> {
    const runDir = resolve(this.paths.mailboxDir, runId);
    if (!this.initializedRuns.has(runId)) {
      await mkdir(runDir, { recursive: true });
      await this.synchronizeState(runId, runDir);
      await this.persistState(runId, runDir);
      this.initializedRuns.add(runId);
    }
    return runDir;
  }

  private async readNextSynchronized(
    runId: string,
  ): Promise<AgentLoopMailboxMessage | undefined> {
    return this.withRunLock(runId, async (runDir) => this.readNextLocked(runId, runDir));
  }

  private async readNextLocked(
    runId: string,
    runDir: string,
  ): Promise<AgentLoopMailboxMessage | undefined> {
    const state = this.requireState(runId);
    while (state.nextReadSequence < state.nextWriteSequence) {
      const filePath = resolve(
        runDir,
        `${state.nextReadSequence.toString().padStart(12, "0")}.json`,
      );
      let content: string | undefined;
      try {
        content = await readFile(filePath, "utf8");
      } catch (error) {
        if (isFileNotFound(error)) {
          state.nextReadSequence += 1;
          continue;
        }
        throw error;
      }
      const message = parseMailboxMessage(content, runId, filePath);
      state.nextReadSequence += 1;
      await this.persistState(runId, runDir);
      return message;
    }
    return undefined;
  }

  private requireState(runId: string): MailboxState {
    const state = this.states.get(runId);
    if (!state) {
      throw new Error(`Harness mailbox state missing for run ${runId}`);
    }
    return state;
  }

  private async persistState(runId: string, runDir?: string): Promise<void> {
    const state = this.requireState(runId);
    await writeJsonAtomic(
      runDir ? resolve(runDir, "state.json") : resolve(this.paths.mailboxDir, runId, "state.json"),
      state,
    );
  }

  private removeWaiter(runId: string, target: NotificationWaiter): void {
    const current = this.waiters.get(runId);
    if (!current) {
      return;
    }
    const next = current.filter((entry) => entry !== target);
    if (next.length === 0) {
      this.waiters.delete(runId);
      return;
    }
    this.waiters.set(runId, next);
  }

  private async synchronizeState(runId: string, runDir: string): Promise<MailboxState> {
    const persisted = await readMailboxStateFile(resolve(runDir, "state.json"), runId);
    const entries = await readdir(runDir).catch((error) => {
      if (isFileNotFound(error)) {
        return [] as string[];
      }
      throw error;
    });
    const derived = deriveState(persisted, entries);
    this.states.set(runId, derived);
    return derived;
  }

  private async withRunLock<T>(
    runId: string,
    action: (runDir: string) => Promise<T>,
  ): Promise<T> {
    const runDir = await this.ensureRunReady(runId);
    const lockDir = resolve(runDir, ".lock");
    await acquireRunLock(lockDir);
    try {
      await this.synchronizeState(runId, runDir);
      return await action(runDir);
    } finally {
      await releaseRunLock(lockDir);
    }
  }
}

function deriveState(
  persisted: MailboxState | undefined,
  entries: string[],
): MailboxState {
  const messageSequences = entries
    .filter((entry) => entry.endsWith(".json") && entry !== "state.json")
    .map((entry) => Number(entry.replace(/\.json$/, "")))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const fallback: MailboxState = {
    nextWriteSequence:
      (messageSequences[messageSequences.length - 1] ?? -1) + 1,
    nextReadSequence: messageSequences[0] ?? 0,
  };
  if (!persisted) {
    return fallback;
  }
  const nextWriteSequence = Math.max(
    persisted.nextWriteSequence,
    fallback.nextWriteSequence,
  );
  return {
    nextWriteSequence,
    nextReadSequence: Math.min(
      nextWriteSequence,
      Math.max(0, persisted.nextReadSequence),
    ),
  };
}

async function readMailboxStateFile(
  path: string,
  runId: string,
): Promise<MailboxState | undefined> {
  let parsed: unknown;
  try {
    parsed = await readJsonFile<unknown>(path);
  } catch (error) {
    throw new Error(`Harness mailbox state corrupted for run ${runId}`, {
      cause: error,
    });
  }
  if (parsed == null) {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Number.isInteger((parsed as { nextWriteSequence?: unknown }).nextWriteSequence) ||
    !Number.isInteger((parsed as { nextReadSequence?: unknown }).nextReadSequence)
  ) {
    throw new Error(`Harness mailbox state corrupted for run ${runId}`);
  }
  return {
    nextWriteSequence: (parsed as { nextWriteSequence: number }).nextWriteSequence,
    nextReadSequence: (parsed as { nextReadSequence: number }).nextReadSequence,
  };
}

function parseMailboxMessage(
  content: string,
  runId: string,
  source: string,
): AgentLoopMailboxMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Harness mailbox message corrupted for run ${runId}: ${source}`, {
      cause: error,
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    typeof (parsed as { runId?: unknown }).runId !== "string" ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
    typeof (parsed as { kind?: unknown }).kind !== "string"
  ) {
    throw new Error(`Harness mailbox message corrupted for run ${runId}: ${source}`);
  }
  return parsed as AgentLoopMailboxMessage;
}

function normalizeRunId(runId: string): string {
  const normalized = runId.trim();
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new Error(`Invalid harness mailbox run id: ${runId}`);
  }
  return normalized;
}

function createNotificationWaiter(input: {
  resolve(message: AgentLoopMailboxMessage | undefined): void;
  reject(error: Error): void;
  timeoutMs?: number;
  onTimeout(): void;
}): NotificationWaiter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (input.timeoutMs != null && input.timeoutMs > 0) {
    timer = setTimeout(() => {
      timer = undefined;
      input.onTimeout();
    }, input.timeoutMs);
  }
  return {
    resolve(message) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      input.resolve(message);
    },
    reject(error) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      input.reject(error);
    },
    clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, path);
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

async function acquireRunLock(lockDir: string): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      const lockStats = await stat(lockDir).catch((statError) => {
        if (isFileNotFound(statError)) {
          return undefined;
        }
        throw statError;
      });
      if (lockStats && Date.now() - lockStats.mtimeMs > 30_000) {
        await releaseRunLock(lockDir);
        continue;
      }
      if (Date.now() - startedAt > 5_000) {
        throw new Error(`Timed out acquiring harness mailbox lock: ${lockDir}`);
      }
      await sleep(10);
    }
  }
}

async function releaseRunLock(lockDir: string): Promise<void> {
  await rm(lockDir, { recursive: true, force: true }).catch((error) => {
    if (!isFileNotFound(error)) {
      throw error;
    }
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
