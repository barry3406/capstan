import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CAPSTAN_HARNESS_DIR = ".capstan/harness";
const RUNS_DIR = `${CAPSTAN_HARNESS_DIR}/runs`;
const EVENTS_PATH = `${CAPSTAN_HARNESS_DIR}/events.ndjson`;
const SUMMARIES_DIR = `${CAPSTAN_HARNESS_DIR}/summaries`;
const MEMORY_DIR = `${CAPSTAN_HARNESS_DIR}/memory`;
const DEFAULT_COMPACTION_TAIL = 5;

export type HarnessRunStatus =
  | "running"
  | "paused"
  | "approval_required"
  | "input_required"
  | "completed"
  | "failed"
  | "cancelled";

export type HarnessEventType =
  | "run_started"
  | "run_paused"
  | "run_resumed"
  | "approval_requested"
  | "approval_granted"
  | "input_requested"
  | "input_received"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "run_retried";

export type HarnessActor = "system" | "human" | "agent";

export interface HarnessTaskDefinition {
  key: string;
  title: string;
  description?: string;
  kind?: string;
  artifacts?: readonly string[];
}

export interface HarnessRun {
  id: string;
  taskKey: string;
  taskTitle: string;
  status: HarnessRunStatus;
  attempt: number;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  sequence: number;
  lastEventId: string;
  awaitingInput?: {
    requestedAt: string;
    note?: string;
  };
  lastProvidedInput?: {
    at: string;
    actor: HarnessActor;
    note?: string;
    payload: Record<string, unknown>;
  };
}

export interface HarnessEvent {
  id: string;
  runId: string;
  taskKey: string;
  type: HarnessEventType;
  actor: HarnessActor;
  sequence: number;
  at: string;
  status: HarnessRunStatus;
  summary: string;
  detail?: string;
  payload?: unknown;
}

export interface HarnessRunMutationOptions {
  cwd?: string;
  actor?: HarnessActor;
  note?: string;
}

export interface HarnessListOptions {
  cwd?: string;
  taskKey?: string;
}

export interface HarnessEventListOptions {
  cwd?: string;
  runId?: string;
}

export interface HarnessReplayReport {
  appRoot: string;
  runId: string;
  consistent: boolean;
  eventCount: number;
  stored?: HarnessRun;
  replayed?: HarnessRun;
}

export interface HarnessCompactionOptions {
  cwd?: string;
  tail?: number;
}

export interface HarnessCheckpointSummary {
  type: "approval" | "input";
  requestedAt: string;
  note?: string;
  resolvedAt?: string;
  resolvedBy?: HarnessActor;
  resolution: "granted" | "provided" | "completed" | "failed" | "cancelled" | "pending";
}

export interface HarnessEventPreview {
  sequence: number;
  type: HarnessEventType;
  status: HarnessRunStatus;
  actor: HarnessActor;
  at: string;
  summary: string;
  detail?: string;
}

export interface HarnessCompactionSummary {
  appRoot: string;
  runId: string;
  taskKey: string;
  taskTitle: string;
  status: HarnessRunStatus;
  attempt: number;
  consistent: boolean;
  eventCount: number;
  compressedAt: string;
  tailWindow: number;
  sourceRun: {
    sequence: number;
    lastEventId: string;
    updatedAt: string;
  };
  boundary?: {
    sequence: number;
    eventId: string;
    type: HarnessEventType;
    at: string;
  };
  inputKeys: string[];
  outputKeys: string[];
  recentEvents: HarnessEventPreview[];
  checkpointHistory: HarnessCheckpointSummary[];
  activeCheckpoint?: {
    type: "approval" | "input";
    requestedAt: string;
    note?: string;
  };
  eventCounts: Partial<Record<HarnessEventType, number>>;
  operatorBrief: string;
  error?: string;
}

export interface HarnessSummaryListItem {
  runId: string;
  taskKey: string;
  taskTitle: string;
  status: HarnessRunStatus;
  attempt: number;
  consistent: boolean;
  eventCount: number;
  compressedAt: string;
  fresh: boolean;
}

export interface HarnessMemoryArtifact {
  appRoot: string;
  runId: string;
  taskKey: string;
  taskTitle: string;
  taskDescription?: string;
  status: HarnessRunStatus;
  attempt: number;
  refreshedAt: string;
  sourceRun: {
    sequence: number;
    lastEventId: string;
    updatedAt: string;
  };
  sourceSummary: {
    compressedAt: string;
    tailWindow: number;
  };
  nextAction:
    | "continue"
    | "resume"
    | "await_approval"
    | "await_input"
    | "retry"
    | "inspect_output"
    | "review_cancellation";
  summaryPath: string;
  inputKeys: string[];
  outputKeys: string[];
  operatorBrief: string;
  suggestedCommands: string[];
  recentEvents: HarnessEventPreview[];
  activeCheckpoint?: {
    type: "approval" | "input";
    requestedAt: string;
    note?: string;
  };
  error?: string;
  prompt: string;
}

export interface HarnessSummaryAccessOptions extends HarnessCompactionOptions {
  refresh?: boolean;
}

interface HarnessAppGraph {
  tasks?: HarnessTaskDefinition[];
}

type TransitionInput =
  | {
      type: "run_started";
      actor: HarnessActor;
      at: string;
      note?: string;
      input: Record<string, unknown>;
      task: HarnessTaskDefinition;
    }
  | {
      type: "run_paused";
      actor: HarnessActor;
      at: string;
      note?: string;
    }
  | {
      type: "run_resumed";
      actor: HarnessActor;
      at: string;
      note?: string;
    }
  | {
      type: "approval_requested";
      actor: HarnessActor;
      at: string;
      note?: string;
    }
  | {
      type: "approval_granted";
      actor: HarnessActor;
      at: string;
      note?: string;
    }
  | {
      type: "input_requested";
      actor: HarnessActor;
      at: string;
      note?: string;
    }
  | {
      type: "input_received";
      actor: HarnessActor;
      at: string;
      note?: string;
      input: Record<string, unknown>;
    }
  | {
      type: "run_completed";
      actor: HarnessActor;
      at: string;
      note?: string;
      output: unknown;
    }
  | {
      type: "run_failed";
      actor: HarnessActor;
      at: string;
      error: string;
    }
  | {
      type: "run_cancelled";
      actor: HarnessActor;
      at: string;
      note?: string;
    }
  | {
      type: "run_retried";
      actor: HarnessActor;
      at: string;
      note?: string;
    };

export async function createHarnessRun(
  appRoot: string,
  taskKey: string,
  input: Record<string, unknown> = {},
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const task = await readTaskDefinition(root, taskKey);
  const at = new Date().toISOString();
  const event = buildStartEvent(task, input, {
    actor: options.actor ?? "agent",
    at,
    ...(options.note ? { note: options.note } : {})
  });
  const run = reduceHarnessEvent(undefined, event);

  await persistHarnessRun(root, run);
  await appendHarnessEvent(root, event);
  return run;
}

export async function getHarnessRun(
  appRoot: string,
  runId: string,
  options: { cwd?: string } = {}
): Promise<HarnessRun | undefined> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  return readHarnessRun(root, runId);
}

export async function listHarnessRuns(
  appRoot: string,
  options: HarnessListOptions = {}
): Promise<HarnessRun[]> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const runsDir = resolve(root, RUNS_DIR);

  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const runs = (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const source = await readFile(resolve(runsDir, entry), "utf8");
            return JSON.parse(source) as HarnessRun;
          } catch {
            return undefined;
          }
        })
    )
  ).filter((run): run is HarnessRun => Boolean(run));

  return runs
    .filter((run) => (options.taskKey ? run.taskKey === options.taskKey : true))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function pauseHarnessRun(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "run_paused",
    actor: options.actor ?? "human",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function resumeHarnessRun(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "run_resumed",
    actor: options.actor ?? "agent",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function requestHarnessApproval(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "approval_requested",
    actor: options.actor ?? "agent",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function approveHarnessRun(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "approval_granted",
    actor: options.actor ?? "human",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function requestHarnessInput(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "input_requested",
    actor: options.actor ?? "agent",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function provideHarnessInput(
  appRoot: string,
  runId: string,
  input: Record<string, unknown>,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "input_received",
    actor: options.actor ?? "human",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {}),
    input
  }, options.cwd);
}

export async function completeHarnessRun(
  appRoot: string,
  runId: string,
  output: unknown,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "run_completed",
    actor: options.actor ?? "agent",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {}),
    output
  }, options.cwd);
}

export async function failHarnessRun(
  appRoot: string,
  runId: string,
  error: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "run_failed",
    actor: options.actor ?? "agent",
    at: new Date().toISOString(),
    error
  }, options.cwd);
}

export async function retryHarnessRun(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "run_retried",
    actor: options.actor ?? "agent",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function cancelHarnessRun(
  appRoot: string,
  runId: string,
  options: HarnessRunMutationOptions = {}
): Promise<HarnessRun> {
  return mutateHarnessRun(appRoot, runId, {
    type: "run_cancelled",
    actor: options.actor ?? "human",
    at: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {})
  }, options.cwd);
}

export async function listHarnessEvents(
  appRoot: string,
  options: HarnessEventListOptions = {}
): Promise<HarnessEvent[]> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const eventsPath = resolve(root, EVENTS_PATH);

  let source: string;
  try {
    source = await readFile(eventsPath, "utf8");
  } catch {
    return [];
  }

  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HarnessEvent)
    .filter((event) => (options.runId ? event.runId === options.runId : true))
    .sort((left, right) =>
      left.runId === right.runId
        ? left.sequence - right.sequence
        : left.at.localeCompare(right.at)
    );
}

export async function replayHarnessRun(
  appRoot: string,
  runId: string,
  options: { cwd?: string } = {}
): Promise<HarnessReplayReport> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const stored = await readHarnessRun(root, runId);
  const events = await listHarnessEvents(root, {
    runId
  });

  let replayed: HarnessRun | undefined;
  for (const event of events) {
    replayed = reduceHarnessEvent(replayed, event);
  }

  return {
    appRoot: root,
    runId,
    consistent: compareHarnessRuns(stored, replayed),
    eventCount: events.length,
    ...(stored ? { stored } : {}),
    ...(replayed ? { replayed } : {})
  };
}

export async function compactHarnessRun(
  appRoot: string,
  runId: string,
  options: HarnessCompactionOptions = {}
): Promise<HarnessCompactionSummary> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const stored = await readHarnessRunOrThrow(root, runId);
  const events = await listHarnessEvents(root, { runId });

  let replayed: HarnessRun | undefined;
  for (const event of events) {
    replayed = reduceHarnessEvent(replayed, event);
  }

  const tailWindow = normalizeTailWindow(options.tail);
  const summary = summarizeHarnessRun(root, stored, events, {
    consistent: compareHarnessRuns(stored, replayed),
    tailWindow
  });

  await persistHarnessSummary(root, summary);
  return summary;
}

export async function getHarnessSummary(
  appRoot: string,
  runId: string,
  options: HarnessSummaryAccessOptions = {}
): Promise<HarnessCompactionSummary> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const currentRun = await readHarnessRunOrThrow(root, runId);

  if (options.refresh) {
    return compactHarnessRun(root, runId, options);
  }

  const stored = await readHarnessSummary(root, runId);
  if (stored && isHarnessSummaryFresh(currentRun, stored)) {
    return stored;
  }

  return compactHarnessRun(root, runId, options);
}

export async function listHarnessSummaries(
  appRoot: string,
  options: { cwd?: string } = {}
): Promise<HarnessSummaryListItem[]> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const summariesDir = resolve(root, SUMMARIES_DIR);

  let entries: string[];
  try {
    entries = await readdir(summariesDir);
  } catch {
    return [];
  }

  const summaries = (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const source = await readFile(resolve(summariesDir, entry), "utf8");
            return JSON.parse(source) as HarnessCompactionSummary;
          } catch {
            return undefined;
          }
        })
    )
  ).filter((summary): summary is HarnessCompactionSummary => Boolean(summary));

  const items = await Promise.all(
    summaries.map(async (summary) => {
      const run = await readHarnessRun(root, summary.runId);
      return {
        runId: summary.runId,
        taskKey: summary.taskKey,
        taskTitle: summary.taskTitle,
        status: summary.status,
        attempt: summary.attempt,
        consistent: summary.consistent,
        eventCount: summary.eventCount,
        compressedAt: summary.compressedAt,
        fresh: run ? isHarnessSummaryFresh(run, summary) : false
      };
    })
  );

  return items.sort((left, right) => right.compressedAt.localeCompare(left.compressedAt));
}

export async function createHarnessMemory(
  appRoot: string,
  runId: string,
  options: HarnessSummaryAccessOptions = {}
): Promise<HarnessMemoryArtifact> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const summary = await getHarnessSummary(root, runId, options);
  const task = await readTaskDefinition(root, summary.taskKey);
  const run = await readHarnessRunOrThrow(root, summary.runId);
  const refreshedAt = new Date().toISOString();
  const artifact: HarnessMemoryArtifact = {
    appRoot: root,
    runId: summary.runId,
    taskKey: summary.taskKey,
    taskTitle: summary.taskTitle,
    ...(task.description ? { taskDescription: task.description } : {}),
    status: summary.status,
    attempt: summary.attempt,
    refreshedAt,
    sourceRun: {
      sequence: run.sequence,
      lastEventId: run.lastEventId,
      updatedAt: run.updatedAt
    },
    sourceSummary: {
      compressedAt: summary.compressedAt,
      tailWindow: summary.tailWindow
    },
    nextAction: decideHarnessNextAction(summary),
    summaryPath: resolve(root, SUMMARIES_DIR, `${summary.runId}.json`),
    inputKeys: summary.inputKeys,
    outputKeys: summary.outputKeys,
    operatorBrief: summary.operatorBrief,
    suggestedCommands: buildHarnessSuggestedCommands(summary),
    recentEvents: summary.recentEvents,
    ...(summary.activeCheckpoint ? { activeCheckpoint: summary.activeCheckpoint } : {}),
    ...(summary.error ? { error: summary.error } : {}),
    prompt: buildHarnessMemoryPrompt(summary, task)
  };

  await persistHarnessMemory(root, artifact);
  return artifact;
}

export async function getHarnessMemory(
  appRoot: string,
  runId: string,
  options: HarnessSummaryAccessOptions = {}
): Promise<HarnessMemoryArtifact> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const currentRun = await readHarnessRunOrThrow(root, runId);

  if (options.refresh) {
    return createHarnessMemory(root, runId, options);
  }

  const stored = await readHarnessMemory(root, runId);
  if (stored && isHarnessMemoryFresh(currentRun, stored)) {
    return stored;
  }

  return createHarnessMemory(root, runId, options);
}

export async function listHarnessMemories(
  appRoot: string,
  options: { cwd?: string } = {}
): Promise<
  Array<
    Pick<
      HarnessMemoryArtifact,
      "runId" | "taskKey" | "taskTitle" | "status" | "attempt" | "refreshedAt" | "nextAction"
    > & { fresh: boolean }
  >
> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const memoryDir = resolve(root, MEMORY_DIR);

  let entries: string[];
  try {
    entries = await readdir(memoryDir);
  } catch {
    return [];
  }

  const memories = (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const source = await readFile(resolve(memoryDir, entry), "utf8");
            return JSON.parse(source) as HarnessMemoryArtifact;
          } catch {
            return undefined;
          }
        })
    )
  ).filter((artifact): artifact is HarnessMemoryArtifact => Boolean(artifact));

  const items = await Promise.all(
    memories.map(async (artifact) => {
      const run = await readHarnessRun(root, artifact.runId);
      return {
        runId: artifact.runId,
        taskKey: artifact.taskKey,
        taskTitle: artifact.taskTitle,
        status: artifact.status,
        attempt: artifact.attempt,
        refreshedAt: artifact.refreshedAt,
        nextAction: artifact.nextAction,
        fresh: run ? isHarnessMemoryFresh(run, artifact) : false
      };
    })
  );

  return items.sort((left, right) => right.refreshedAt.localeCompare(left.refreshedAt));
}

export function serializeHarnessEvent(event: HarnessEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function renderHarnessRunText(run: HarnessRun): string {
  const lines = [
    "Capstan Harness Run",
    `Run: ${run.id}`,
    `Task: ${run.taskTitle} (${run.taskKey})`,
    `Status: ${run.status}`,
    `Attempt: ${run.attempt}`,
    `Created At: ${run.createdAt}`,
    `Updated At: ${run.updatedAt}`
  ];

  if (run.error) {
    lines.push(`Error: ${run.error}`);
  }

  if (run.awaitingInput) {
    lines.push(`Awaiting Input Since: ${run.awaitingInput.requestedAt}`);
    if (run.awaitingInput.note) {
      lines.push(`Awaiting Input Note: ${run.awaitingInput.note}`);
    }
  }

  if (run.lastProvidedInput) {
    lines.push(`Last Provided Input At: ${run.lastProvidedInput.at}`);
    lines.push(`Last Provided Input Actor: ${run.lastProvidedInput.actor}`);
    if (run.lastProvidedInput.note) {
      lines.push(`Last Provided Input Note: ${run.lastProvidedInput.note}`);
    }
  }

  if (typeof run.output !== "undefined") {
    lines.push("Output:");
    lines.push(JSON.stringify(run.output, null, 2));
  }

  return `${lines.join("\n")}\n`;
}

export function renderHarnessRunsText(runs: readonly HarnessRun[]): string {
  const lines = ["Capstan Harness Runs"];

  if (!runs.length) {
    lines.push("");
    lines.push("No harness runs were found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  for (const run of runs) {
    lines.push(
      `- [${run.status}] ${run.taskTitle} (${run.taskKey}) · ${run.id} · attempt ${run.attempt}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function renderHarnessEventsText(events: readonly HarnessEvent[]): string {
  const lines = ["Capstan Harness Events"];

  if (!events.length) {
    lines.push("");
    lines.push("No harness events were found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  for (const event of events) {
    lines.push(
      `- #${event.sequence} [${event.status}] ${event.type} · run=${event.runId} · ${event.summary}`
    );
    if (event.detail) {
      lines.push(`  detail: ${event.detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderHarnessReplayText(report: HarnessReplayReport): string {
  const lines = [
    "Capstan Harness Replay",
    `Run: ${report.runId}`,
    `Consistent: ${report.consistent}`,
    `Event Count: ${report.eventCount}`
  ];

  if (report.replayed) {
    lines.push(`Replayed Status: ${report.replayed.status}`);
    lines.push(`Replayed Attempt: ${report.replayed.attempt}`);
  }

  if (report.stored) {
    lines.push(`Stored Status: ${report.stored.status}`);
    lines.push(`Stored Attempt: ${report.stored.attempt}`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderHarnessCompactionText(summary: HarnessCompactionSummary): string {
  const lines = [
    "Capstan Harness Summary",
    `Run: ${summary.runId}`,
    `Task: ${summary.taskTitle} (${summary.taskKey})`,
    `Status: ${summary.status}`,
    `Attempt: ${summary.attempt}`,
    `Consistent: ${summary.consistent}`,
    `Event Count: ${summary.eventCount}`,
    `Tail Window: ${summary.tailWindow}`,
    `Compressed At: ${summary.compressedAt}`,
    `Brief: ${summary.operatorBrief}`
  ];

  if (summary.activeCheckpoint) {
    lines.push(
      `Active Checkpoint: ${summary.activeCheckpoint.type} requested at ${summary.activeCheckpoint.requestedAt}`
    );
    if (summary.activeCheckpoint.note) {
      lines.push(`Active Checkpoint Note: ${summary.activeCheckpoint.note}`);
    }
  }

  if (summary.error) {
    lines.push(`Error: ${summary.error}`);
  }

  if (summary.inputKeys.length) {
    lines.push(`Input Keys: ${summary.inputKeys.join(", ")}`);
  }

  if (summary.outputKeys.length) {
    lines.push(`Output Keys: ${summary.outputKeys.join(", ")}`);
  }

  if (summary.recentEvents.length) {
    lines.push("Recent Events:");
    for (const event of summary.recentEvents) {
      lines.push(
        `- #${event.sequence} [${event.status}] ${event.type} · ${event.actor} · ${event.summary}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderHarnessSummariesText(summaries: readonly HarnessSummaryListItem[]): string {
  const lines = ["Capstan Harness Summaries"];

  if (!summaries.length) {
    lines.push("");
    lines.push("No harness summaries were found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  for (const summary of summaries) {
    lines.push(
      `- [${summary.status}] ${summary.taskTitle} (${summary.taskKey}) · ${summary.runId} · attempt ${summary.attempt} · consistent=${summary.consistent} · fresh=${summary.fresh}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function renderHarnessMemoryText(artifact: HarnessMemoryArtifact): string {
  const lines = [
    "Capstan Harness Memory",
    `Run: ${artifact.runId}`,
    `Task: ${artifact.taskTitle} (${artifact.taskKey})`,
    `Status: ${artifact.status}`,
    `Attempt: ${artifact.attempt}`,
    `Refreshed At: ${artifact.refreshedAt}`,
    `Next Action: ${artifact.nextAction}`,
    `Operator Brief: ${artifact.operatorBrief}`
  ];

  if (artifact.taskDescription) {
    lines.push(`Task Description: ${artifact.taskDescription}`);
  }

  if (artifact.activeCheckpoint) {
    lines.push(
      `Active Checkpoint: ${artifact.activeCheckpoint.type} requested at ${artifact.activeCheckpoint.requestedAt}`
    );
    if (artifact.activeCheckpoint.note) {
      lines.push(`Active Checkpoint Note: ${artifact.activeCheckpoint.note}`);
    }
  }

  if (artifact.error) {
    lines.push(`Error: ${artifact.error}`);
  }

  if (artifact.suggestedCommands.length) {
    lines.push("Suggested Commands:");
    for (const command of artifact.suggestedCommands) {
      lines.push(`- ${command}`);
    }
  }

  lines.push("");
  lines.push("Prompt:");
  lines.push(artifact.prompt);

  return `${lines.join("\n")}\n`;
}

export function renderHarnessMemoriesText(
  memories: ReadonlyArray<
    (Pick<
      HarnessMemoryArtifact,
      "runId" | "taskKey" | "taskTitle" | "status" | "attempt" | "refreshedAt" | "nextAction"
    > & { fresh: boolean })
  >
): string {
  const lines = ["Capstan Harness Memories"];

  if (!memories.length) {
    lines.push("");
    lines.push("No harness memory artifacts were found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  for (const artifact of memories) {
    lines.push(
      `- [${artifact.status}] ${artifact.taskTitle} (${artifact.taskKey}) · ${artifact.runId} · attempt ${artifact.attempt} · next=${artifact.nextAction} · fresh=${artifact.fresh}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function summarizeHarnessRun(
  appRoot: string,
  run: HarnessRun,
  events: readonly HarnessEvent[],
  options: { consistent: boolean; tailWindow?: number }
): HarnessCompactionSummary {
  const tailWindow = normalizeTailWindow(options.tailWindow);
  const recentEvents = events.slice(-tailWindow).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    status: event.status,
    actor: event.actor,
    at: event.at,
    summary: event.summary,
    ...(event.detail ? { detail: event.detail } : {})
  }));
  const latestEvent = events.at(-1);
  const checkpointHistory = summarizeHarnessCheckpoints(events);
  const activeCheckpoint = checkpointHistory.find((checkpoint) => checkpoint.resolution === "pending");
  const eventCounts = summarizeHarnessEventCounts(events);
  const inputKeys = Object.keys(run.input).sort((left, right) => left.localeCompare(right));
  const outputKeys = summarizeOutputKeys(run.output);

  return {
    appRoot,
    runId: run.id,
    taskKey: run.taskKey,
    taskTitle: run.taskTitle,
    status: run.status,
    attempt: run.attempt,
    consistent: options.consistent,
    eventCount: events.length,
    compressedAt: new Date().toISOString(),
    tailWindow,
    sourceRun: {
      sequence: run.sequence,
      lastEventId: run.lastEventId,
      updatedAt: run.updatedAt
    },
    ...(latestEvent
      ? {
          boundary: {
            sequence: latestEvent.sequence,
            eventId: latestEvent.id,
            type: latestEvent.type,
            at: latestEvent.at
          }
        }
      : {}),
    inputKeys,
    outputKeys,
    recentEvents,
    checkpointHistory,
    ...(activeCheckpoint
      ? {
          activeCheckpoint: {
            type: activeCheckpoint.type,
            requestedAt: activeCheckpoint.requestedAt,
            ...(activeCheckpoint.note ? { note: activeCheckpoint.note } : {})
          }
        }
      : {}),
    eventCounts,
    operatorBrief: buildHarnessOperatorBrief(run, events, activeCheckpoint),
    ...(run.error ? { error: run.error } : {})
  };
}

export function reduceHarnessEvent(
  current: HarnessRun | undefined,
  event: HarnessEvent | ReturnType<typeof buildStartEvent>
): HarnessRun {
  switch (event.type) {
    case "run_started": {
      if (current) {
        throw new Error(`Run "${current.id}" has already been started.`);
      }

      const payload = ensureObjectPayload(event.payload);
      const taskTitle = readStringPayload(payload, "taskTitle");
      const attempt = readNumberPayload(payload, "attempt");
      const input = ensureRecordPayload(payload, "input");

      return {
        id: event.runId,
        taskKey: event.taskKey,
        taskTitle,
        status: "running",
        attempt,
        input,
        createdAt: event.at,
        updatedAt: event.at,
        sequence: event.sequence,
        lastEventId: event.id
      };
    }
    case "run_paused":
      return transitionHarnessRun(current, event, ["running"], "paused");
    case "run_resumed":
      return transitionHarnessRun(current, event, ["paused"], "running");
    case "approval_requested":
      return transitionHarnessRun(current, event, ["running", "paused"], "approval_required");
    case "approval_granted":
      return transitionHarnessRun(current, event, ["approval_required"], "running");
    case "input_requested": {
      const next = transitionHarnessRun(current, event, ["running", "paused"], "input_required");
      return {
        ...next,
        awaitingInput: {
          requestedAt: event.at,
          ...(event.detail ? { note: event.detail } : {})
        }
      };
    }
    case "input_received": {
      const next = transitionHarnessRun(current, event, ["input_required"], "running");
      const providedInput = ensureRecordPayload(ensureObjectPayload(event.payload), "input");
      const { awaitingInput: _awaitingInput, ...rest } = next;

      return {
        ...rest,
        input: {
          ...next.input,
          ...providedInput
        },
        lastProvidedInput: {
          at: event.at,
          actor: event.actor,
          ...(event.detail ? { note: event.detail } : {}),
          payload: providedInput
        }
      };
    }
    case "run_completed": {
      const next = transitionHarnessRun(current, event, ["running"], "completed");
      return {
        ...next,
        output: event.payload
      };
    }
    case "run_failed": {
      const next = transitionHarnessRun(current, event, ["running", "paused", "approval_required"], "failed");
      return {
        ...next,
        error: event.detail ?? "Harness run failed."
      };
    }
    case "run_cancelled":
      return transitionHarnessRun(
        current,
        event,
        ["running", "paused", "approval_required", "input_required"],
        "cancelled"
      );
    case "run_retried": {
      const next = transitionHarnessRun(current, event, ["failed", "cancelled"], "running");
      const {
        output: _output,
        error: _error,
        awaitingInput: _awaitingInput,
        ...rest
      } = next;
      return {
        ...rest,
        attempt: next.attempt + 1
      };
    }
    default:
      throw new Error(`Unsupported harness event "${event.type}".`);
  }
}

function transitionHarnessRun(
  current: HarnessRun | undefined,
  event: HarnessEvent,
  allowedStatuses: HarnessRunStatus[],
  nextStatus: HarnessRunStatus
): HarnessRun {
  if (!current) {
    throw new Error(`Cannot apply "${event.type}" before a run has started.`);
  }

  if (!allowedStatuses.includes(current.status)) {
    throw new Error(
      `Cannot apply "${event.type}" when run "${current.id}" is in status "${current.status}".`
    );
  }

  return {
    ...current,
    status: nextStatus,
    updatedAt: event.at,
    sequence: event.sequence,
    lastEventId: event.id
  };
}

async function mutateHarnessRun(
  appRoot: string,
  runId: string,
  input: Exclude<TransitionInput, { type: "run_started" }>,
  cwd?: string
): Promise<HarnessRun> {
  const root = resolve(cwd ?? process.cwd(), appRoot);
  const current = await readHarnessRunOrThrow(root, runId);
  const event = buildHarnessEvent(current, input);
  const next = reduceHarnessEvent(current, event);

  await persistHarnessRun(root, next);
  await appendHarnessEvent(root, event);
  return next;
}

async function readTaskDefinition(appRoot: string, taskKey: string): Promise<HarnessTaskDefinition> {
  const graph = await readAppGraph(appRoot);
  const task = graph.tasks?.find((candidate) => candidate.key === taskKey);

  if (!task) {
    throw new Error(`Unknown task "${taskKey}".`);
  }

  return task;
}

async function readAppGraph(appRoot: string): Promise<HarnessAppGraph> {
  const source = await readFile(resolve(appRoot, "capstan.app.json"), "utf8");
  return JSON.parse(source) as HarnessAppGraph;
}

async function ensureHarnessDirectories(appRoot: string): Promise<void> {
  await mkdir(resolve(appRoot, RUNS_DIR), { recursive: true });
  await mkdir(resolve(appRoot, dirname(EVENTS_PATH)), { recursive: true });
  await mkdir(resolve(appRoot, SUMMARIES_DIR), { recursive: true });
  await mkdir(resolve(appRoot, MEMORY_DIR), { recursive: true });
}

async function persistHarnessRun(appRoot: string, run: HarnessRun): Promise<void> {
  await ensureHarnessDirectories(appRoot);
  await writeFile(
    resolve(appRoot, RUNS_DIR, `${run.id}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8"
  );
}

async function appendHarnessEvent(appRoot: string, event: HarnessEvent): Promise<void> {
  await ensureHarnessDirectories(appRoot);
  await writeFile(resolve(appRoot, EVENTS_PATH), serializeHarnessEvent(event), {
    encoding: "utf8",
    flag: "a"
  });
}

async function persistHarnessSummary(
  appRoot: string,
  summary: HarnessCompactionSummary
): Promise<void> {
  await ensureHarnessDirectories(appRoot);
  await writeFile(
    resolve(appRoot, SUMMARIES_DIR, `${summary.runId}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
}

async function persistHarnessMemory(
  appRoot: string,
  artifact: HarnessMemoryArtifact
): Promise<void> {
  await ensureHarnessDirectories(appRoot);
  await writeFile(
    resolve(appRoot, MEMORY_DIR, `${artifact.runId}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
}

async function readHarnessRun(appRoot: string, runId: string): Promise<HarnessRun | undefined> {
  try {
    const source = await readFile(resolve(appRoot, RUNS_DIR, `${runId}.json`), "utf8");
    return JSON.parse(source) as HarnessRun;
  } catch {
    return undefined;
  }
}

async function readHarnessSummary(
  appRoot: string,
  runId: string
): Promise<HarnessCompactionSummary | undefined> {
  try {
    const source = await readFile(resolve(appRoot, SUMMARIES_DIR, `${runId}.json`), "utf8");
    return JSON.parse(source) as HarnessCompactionSummary;
  } catch {
    return undefined;
  }
}

async function readHarnessMemory(
  appRoot: string,
  runId: string
): Promise<HarnessMemoryArtifact | undefined> {
  try {
    const source = await readFile(resolve(appRoot, MEMORY_DIR, `${runId}.json`), "utf8");
    return JSON.parse(source) as HarnessMemoryArtifact;
  } catch {
    return undefined;
  }
}

async function readHarnessRunOrThrow(appRoot: string, runId: string): Promise<HarnessRun> {
  const run = await readHarnessRun(appRoot, runId);
  if (!run) {
    throw new Error(`Unknown harness run "${runId}".`);
  }

  return run;
}

function buildStartEvent(
  task: HarnessTaskDefinition,
  input: Record<string, unknown>,
  options: { actor: HarnessActor; at: string; note?: string }
): HarnessEvent {
  return {
    id: randomUUID(),
    runId: `harness-run-${randomUUID()}`,
    taskKey: task.key,
    type: "run_started",
    actor: options.actor,
    sequence: 1,
    at: options.at,
    status: "running",
    summary: `Started harness run for "${task.title}".`,
    ...(options.note ? { detail: options.note } : {}),
    payload: {
      taskTitle: task.title,
      attempt: 1,
      input
    }
  };
}

function buildHarnessEvent(
  current: HarnessRun,
  input: Exclude<TransitionInput, { type: "run_started" }>
): HarnessEvent {
  const base = {
    id: randomUUID(),
    runId: current.id,
    taskKey: current.taskKey,
    actor: input.actor,
    sequence: current.sequence + 1,
    at: input.at
  };

  switch (input.type) {
    case "run_paused":
      return {
        ...base,
        type: "run_paused",
        status: "paused",
        summary: `Paused harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {})
      };
    case "run_resumed":
      return {
        ...base,
        type: "run_resumed",
        status: "running",
        summary: `Resumed harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {})
      };
    case "approval_requested":
      return {
        ...base,
        type: "approval_requested",
        status: "approval_required",
        summary: `Requested approval for harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {})
      };
    case "approval_granted":
      return {
        ...base,
        type: "approval_granted",
        status: "running",
        summary: `Approval granted for harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {})
      };
    case "input_requested":
      return {
        ...base,
        type: "input_requested",
        status: "input_required",
        summary: `Requested additional input for harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {})
      };
    case "input_received":
      return {
        ...base,
        type: "input_received",
        status: "running",
        summary: `Provided input for harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {}),
        payload: {
          input: input.input
        }
      };
    case "run_completed":
      return {
        ...base,
        type: "run_completed",
        status: "completed",
        summary: `Completed harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {}),
        payload: input.output
      };
    case "run_failed":
      return {
        ...base,
        type: "run_failed",
        status: "failed",
        summary: `Harness run "${current.id}" failed.`,
        detail: input.error
      };
    case "run_cancelled":
      return {
        ...base,
        type: "run_cancelled",
        status: "cancelled",
        summary: `Cancelled harness run "${current.id}".`,
        ...(input.note ? { detail: input.note } : {})
      };
    case "run_retried":
      return {
        ...base,
        type: "run_retried",
        status: "running",
        summary: `Retried harness run "${current.id}".`,
        detail: input.note ?? `Attempt ${current.attempt + 1} started.`
      };
    default: {
      const exhaustive: never = input;
      throw new Error(`Unsupported harness transition ${String(exhaustive)}.`);
    }
  }
}

function compareHarnessRuns(
  stored: HarnessRun | undefined,
  replayed: HarnessRun | undefined
): boolean {
  if (!stored || !replayed) {
    return false;
  }

  return JSON.stringify(stored) === JSON.stringify(replayed);
}

function isHarnessSummaryFresh(
  current: HarnessRun,
  summary: HarnessCompactionSummary
): boolean {
  return (
    summary.sourceRun.sequence === current.sequence &&
    summary.sourceRun.lastEventId === current.lastEventId &&
    summary.status === current.status &&
    summary.attempt === current.attempt
  );
}

function isHarnessMemoryFresh(
  current: HarnessRun,
  artifact: HarnessMemoryArtifact
): boolean {
  return (
    artifact.sourceRun.sequence === current.sequence &&
    artifact.sourceRun.lastEventId === current.lastEventId &&
    artifact.status === current.status &&
    artifact.attempt === current.attempt
  );
}

function decideHarnessNextAction(
  summary: HarnessCompactionSummary
): HarnessMemoryArtifact["nextAction"] {
  switch (summary.status) {
    case "running":
      return "continue";
    case "paused":
      return "resume";
    case "approval_required":
      return "await_approval";
    case "input_required":
      return "await_input";
    case "failed":
      return "retry";
    case "completed":
      return "inspect_output";
    case "cancelled":
      return "review_cancellation";
  }
}

function buildHarnessSuggestedCommands(summary: HarnessCompactionSummary): string[] {
  switch (summary.status) {
    case "running":
      return [
        `capstan harness:get <app-dir> ${summary.runId} --json`,
        `capstan harness:events <app-dir> --run ${summary.runId} --json`
      ];
    case "paused":
      return [`capstan harness:resume <app-dir> ${summary.runId} --json`];
    case "approval_required":
      return [`capstan harness:approve <app-dir> ${summary.runId} --json`];
    case "input_required":
      return [
        `capstan harness:provide-input <app-dir> ${summary.runId} --input ./input.json --json`
      ];
    case "failed":
      return [`capstan harness:retry <app-dir> ${summary.runId} --json`];
    case "completed":
      return [
        `capstan harness:get <app-dir> ${summary.runId} --json`,
        `capstan harness:compact <app-dir> ${summary.runId} --json`
      ];
    case "cancelled":
      return [
        `capstan harness:retry <app-dir> ${summary.runId} --json`,
        `capstan harness:events <app-dir> --run ${summary.runId} --json`
      ];
  }
}

function buildHarnessMemoryPrompt(
  summary: HarnessCompactionSummary,
  task: HarnessTaskDefinition
): string {
  const lines = [
    `You are resuming Capstan harness run "${summary.runId}".`,
    `Task: ${summary.taskTitle} (${summary.taskKey})`,
    `Status: ${summary.status}`,
    `Attempt: ${summary.attempt}`,
    `Operator brief: ${summary.operatorBrief}`
  ];

  if (task.description) {
    lines.push(`Task description: ${task.description}`);
  }

  if (summary.activeCheckpoint) {
    lines.push(
      `Active checkpoint: ${summary.activeCheckpoint.type} requested at ${summary.activeCheckpoint.requestedAt}.`
    );
    if (summary.activeCheckpoint.note) {
      lines.push(`Checkpoint note: ${summary.activeCheckpoint.note}`);
    }
  }

  if (summary.inputKeys.length) {
    lines.push(`Known input keys: ${summary.inputKeys.join(", ")}`);
  }

  if (summary.outputKeys.length) {
    lines.push(`Known output keys: ${summary.outputKeys.join(", ")}`);
  }

  if (summary.error) {
    lines.push(`Last error: ${summary.error}`);
  }

  if (summary.recentEvents.length) {
    lines.push("Recent events:");
    for (const event of summary.recentEvents) {
      lines.push(
        `- #${event.sequence} ${event.type} [${event.status}] by ${event.actor}: ${event.summary}`
      );
    }
  }

  return lines.join("\n");
}

function summarizeHarnessCheckpoints(
  events: readonly HarnessEvent[]
): HarnessCheckpointSummary[] {
  const checkpoints: HarnessCheckpointSummary[] = [];

  for (const event of events) {
    if (event.type === "approval_requested" || event.type === "input_requested") {
      checkpoints.push({
        type: event.type === "approval_requested" ? "approval" : "input",
        requestedAt: event.at,
        ...(event.detail ? { note: event.detail } : {}),
        resolution: "pending"
      });
      continue;
    }

    const current = checkpoints.at(-1);
    if (!current || current.resolution !== "pending") {
      continue;
    }

    if (event.type === "approval_granted" && current.type === "approval") {
      current.resolution = "granted";
      current.resolvedAt = event.at;
      current.resolvedBy = event.actor;
      continue;
    }

    if (event.type === "input_received" && current.type === "input") {
      current.resolution = "provided";
      current.resolvedAt = event.at;
      current.resolvedBy = event.actor;
      continue;
    }

    if (event.type === "run_completed") {
      current.resolution = "completed";
      current.resolvedAt = event.at;
      current.resolvedBy = event.actor;
      continue;
    }

    if (event.type === "run_failed") {
      current.resolution = "failed";
      current.resolvedAt = event.at;
      current.resolvedBy = event.actor;
      continue;
    }

    if (event.type === "run_cancelled") {
      current.resolution = "cancelled";
      current.resolvedAt = event.at;
      current.resolvedBy = event.actor;
    }
  }

  return checkpoints;
}

function summarizeHarnessEventCounts(
  events: readonly HarnessEvent[]
): Partial<Record<HarnessEventType, number>> {
  const counts: Partial<Record<HarnessEventType, number>> = {};

  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }

  return counts;
}

function summarizeOutputKeys(output: unknown): string[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [];
  }

  return Object.keys(output as Record<string, unknown>).sort((left, right) =>
    left.localeCompare(right)
  );
}

function buildHarnessOperatorBrief(
  run: HarnessRun,
  events: readonly HarnessEvent[],
  activeCheckpoint: HarnessCheckpointSummary | undefined
): string {
  const latestEvent = events.at(-1);
  const base = `Run "${run.id}" for "${run.taskTitle}" is ${run.status} on attempt ${run.attempt} after ${events.length} events.`;
  const latest = latestEvent
    ? ` Latest event: ${latestEvent.type} at ${latestEvent.at}.`
    : "";
  const checkpoint = activeCheckpoint
    ? ` Waiting on ${activeCheckpoint.type} input since ${activeCheckpoint.requestedAt}.`
    : "";
  const failure = run.error ? ` Last error: ${run.error}.` : "";

  return `${base}${latest}${checkpoint}${failure}`.trim();
}

function normalizeTailWindow(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_COMPACTION_TAIL;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 25);
}

function ensureObjectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Harness event payload must be an object.");
  }

  return payload as Record<string, unknown>;
}

function ensureRecordPayload(
  payload: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Harness event payload "${key}" must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readStringPayload(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Harness event payload "${key}" must be a non-empty string.`);
  }

  return value;
}

function readNumberPayload(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Harness event payload "${key}" must be a finite number.`);
  }

  return value;
}
