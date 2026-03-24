import { artifacts } from "../artifacts/index.js";
import { capabilities, capabilityHandlers } from "../capabilities/index.js";
import { tasks } from "../tasks/index.js";
import type {
  ArtifactDefinition,
  CapabilityDefinition,
  CapabilityExecutionResult,
  TaskDefinition
} from "../types.js";

export interface SearchResult {
  capabilities: readonly CapabilityDefinition[];
  tasks: readonly TaskDefinition[];
  artifacts: readonly ArtifactDefinition[];
}

export interface TaskResult {
  task: TaskDefinition;
  status:
    | "ready"
    | "awaiting_execution"
    | "running"
    | "input_required"
    | "approval_required"
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked";
  capabilities: readonly CapabilityDefinition[];
  artifacts: readonly ArtifactDefinition[];
  runCount: number;
  latestRun?: TaskRun;
}

export interface ArtifactResult {
  artifact: ArtifactDefinition;
  tasks: readonly TaskDefinition[];
  capabilities: readonly CapabilityDefinition[];
  records: readonly ArtifactRecord[];
  latestRecord?: ArtifactRecord;
}

export type TaskRunStatus =
  | "pending"
  | "running"
  | "input_required"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface ArtifactRecord {
  id: string;
  artifactKey: string;
  taskRunId: string;
  taskKey: string;
  capabilityKey: string;
  payload: unknown;
  createdAt: string;
}

export interface TaskRun {
  id: string;
  taskKey: string;
  capabilityKey: string;
  status: TaskRunStatus;
  input: Record<string, unknown>;
  artifacts: readonly ArtifactRecord[];
  result?: CapabilityExecutionResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const taskRuns = new Map<string, TaskRun>();
const artifactRecords = new Map<string, ArtifactRecord>();
let taskRunSequence = 0;
let artifactRecordSequence = 0;

function nextTaskRunId(): string {
  taskRunSequence += 1;
  return `task-run-${taskRunSequence}`;
}

function nextArtifactRecordId(): string {
  artifactRecordSequence += 1;
  return `artifact-record-${artifactRecordSequence}`;
}

function taskRunSequenceValue(run: Pick<TaskRun, "id">): number {
  return Number(run.id.replace("task-run-", "")) || 0;
}

function artifactRecordSequenceValue(record: Pick<ArtifactRecord, "id">): number {
  return Number(record.id.replace("artifact-record-", "")) || 0;
}

function persistTaskRun(run: TaskRun): TaskRun {
  taskRuns.set(run.id, run);
  return run;
}

function persistArtifactRecord(record: ArtifactRecord): ArtifactRecord {
  artifactRecords.set(record.id, record);
  return record;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveTaskStatus(taskDefinition: TaskDefinition, latestRun?: TaskRun): TaskResult["status"] {
  if (!latestRun) {
    return taskDefinition.kind === "durable" ? "awaiting_execution" : "ready";
  }

  switch (latestRun.status) {
    case "pending":
    case "running":
      return "running";
    case "input_required":
      return "input_required";
    case "approval_required":
      return "approval_required";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    default:
      return taskDefinition.kind === "durable" ? "awaiting_execution" : "ready";
  }
}

function resolveTaskRunStatus(result: CapabilityExecutionResult): TaskRunStatus {
  switch (result.status) {
    case "completed":
      return "completed";
    case "input_required":
      return "input_required";
    case "approval_required":
      return "approval_required";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    case "failed":
    case "not_implemented":
    default:
      return "failed";
  }
}

function extractArtifactPayload(output: unknown, artifactKey: string): unknown {
  if (isRecordValue(output)) {
    const artifactMap = output.artifacts;

    if (isRecordValue(artifactMap) && artifactMap[artifactKey] !== undefined) {
      return artifactMap[artifactKey];
    }

    if (output[artifactKey] !== undefined) {
      return output[artifactKey];
    }
  }

  return output;
}

function createArtifactRecords(
  taskDefinition: TaskDefinition,
  capabilityKey: string,
  taskRunId: string,
  result: CapabilityExecutionResult
): ArtifactRecord[] {
  const timestamp = new Date().toISOString();

  return (taskDefinition.artifacts ?? []).map((artifactKey) =>
    persistArtifactRecord({
      id: nextArtifactRecordId(),
      artifactKey,
      taskRunId,
      taskKey: taskDefinition.key,
      capabilityKey,
      payload: extractArtifactPayload(result.output, artifactKey),
      createdAt: timestamp
    })
  );
}

export function search(query = ""): SearchResult {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return {
      capabilities,
      tasks,
      artifacts
    };
  }

  return {
    capabilities: capabilities.filter((capability) =>
      [capability.key, capability.title, capability.description ?? "", ...(capability.resources ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    ),
    tasks: tasks.filter((task) =>
      [task.key, task.title, task.description ?? ""].join(" ").toLowerCase().includes(normalized)
    ),
    artifacts: artifacts.filter((artifact) =>
      [artifact.key, artifact.title, artifact.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    )
  };
}

export function getCapability(key: string): CapabilityDefinition | undefined {
  return capabilities.find((capability) => capability.key === key);
}

export function getTask(key: string): TaskDefinition | undefined {
  return tasks.find((task) => task.key === key);
}

export function getArtifact(key: string): ArtifactDefinition | undefined {
  return artifacts.find((artifact) => artifact.key === key);
}

export function task(key: string): TaskResult {
  const taskDefinition = getTask(key);

  if (!taskDefinition) {
    throw new Error(`Unknown task "${key}".`);
  }

  const matchingCapabilities = capabilities.filter((capability) => capability.task === key);
  const linkedArtifacts = (taskDefinition.artifacts ?? [])
    .map((artifactKey) => getArtifact(artifactKey))
    .filter((artifact): artifact is ArtifactDefinition => Boolean(artifact));
  const runs = listTaskRuns(key);

  return {
    task: taskDefinition,
    status: resolveTaskStatus(taskDefinition, runs[0]),
    capabilities: matchingCapabilities,
    artifacts: linkedArtifacts,
    runCount: runs.length,
    ...(runs[0] ? { latestRun: runs[0] } : {})
  };
}

export function artifact(key: string): ArtifactResult {
  const artifactDefinition = getArtifact(key);

  if (!artifactDefinition) {
    throw new Error(`Unknown artifact "${key}".`);
  }

  const producingTasks = tasks.filter((task) => (task.artifacts ?? []).includes(key));
  const producingTaskKeys = new Set(producingTasks.map((task) => task.key));
  const producingCapabilities = capabilities.filter((capability) =>
    capability.task ? producingTaskKeys.has(capability.task) : false
  );
  const records = listArtifactRecords(key);

  return {
    artifact: artifactDefinition,
    tasks: producingTasks,
    capabilities: producingCapabilities,
    records,
    ...(records[0] ? { latestRecord: records[0] } : {})
  };
}

export function getTaskRun(id: string): TaskRun | undefined {
  return taskRuns.get(id);
}

export function listTaskRuns(taskKey?: string): TaskRun[] {
  const runs = Array.from(taskRuns.values());

  return runs
    .filter((run) => (taskKey ? run.taskKey === taskKey : true))
    .sort((left, right) => taskRunSequenceValue(right) - taskRunSequenceValue(left));
}

export function getArtifactRecord(id: string): ArtifactRecord | undefined {
  return artifactRecords.get(id);
}

export function listArtifactRecords(artifactKey?: string): ArtifactRecord[] {
  return Array.from(artifactRecords.values())
    .filter((record) => (artifactKey ? record.artifactKey === artifactKey : true))
    .sort((left, right) => artifactRecordSequenceValue(right) - artifactRecordSequenceValue(left));
}

export async function startTask(
  key: string,
  input: Record<string, unknown> = {}
): Promise<TaskRun> {
  const taskDefinition = getTask(key);

  if (!taskDefinition) {
    throw new Error(`Unknown task "${key}".`);
  }

  const capability = capabilities.find((entry) => entry.task === key);

  if (!capability) {
    throw new Error(`Task "${key}" is not linked to an executable capability.`);
  }

  const timestamp = new Date().toISOString();
  let run = persistTaskRun({
    id: nextTaskRunId(),
    taskKey: key,
    capabilityKey: capability.key,
    status: "pending",
    input,
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  run = persistTaskRun({
    ...run,
    status: "running",
    updatedAt: new Date().toISOString()
  });

  try {
    const result = await execute(capability.key, input);
    const runStatus = resolveTaskRunStatus(result);
    const linkedArtifactRecords =
      runStatus === "completed"
        ? createArtifactRecords(taskDefinition, capability.key, run.id, result)
        : [];
    const completed = persistTaskRun({
      ...run,
      status: runStatus,
      artifacts: linkedArtifactRecords,
      result,
      updatedAt: new Date().toISOString()
    });

    return completed;
  } catch (error) {
    const failed = persistTaskRun({
      ...run,
      status: "failed",
      artifacts: [],
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    });

    return failed;
  }
}

export async function execute(
  key: string,
  input: Record<string, unknown> = {}
): Promise<CapabilityExecutionResult> {
  const handler = capabilityHandlers[key as keyof typeof capabilityHandlers];

  if (!handler) {
    throw new Error(`Unknown capability "${key}".`);
  }

  return handler(input);
}

export const controlPlane = {
  domain: "operations",
  search,
  task,
  artifact,
  startTask,
  getTaskRun,
  listTaskRuns,
  getArtifactRecord,
  listArtifactRecords,
  execute,
  getCapability,
  getTask,
  getArtifact
} as const;
