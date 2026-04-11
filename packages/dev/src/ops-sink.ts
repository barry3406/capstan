import { resolve } from "node:path";

import type {
  CapstanHealthSnapshot,
  CapstanOpsConfig,
  CapstanOpsEvent,
} from "@zauso-ai/capstan-core";
import {
  createCapstanOpsRuntime as createSemanticOpsRuntime,
  SqliteOpsStore,
  type OpsCaptureSnapshotInput,
  type OpsRecordEventInput,
  type OpsRecordIncidentInput,
  type OpsSeverity,
  type OpsTarget,
} from "@zauso-ai/capstan-ops";

const DEFAULT_OPS_STORE_DIR = ".capstan/ops";
const DEFAULT_OPS_STORE_FILE = "ops.db";

export interface ProjectOpsSinkOptions {
  rootDir: string;
  appName?: string;
  environment?: string;
  storeDir?: string;
  storePath?: string;
}

type ProjectOpsSink = {
  recordEvent(event: CapstanOpsEvent): Promise<void> | void;
  close?(): Promise<void> | void;
};

type ResolvedProjectOpsConfig = CapstanOpsConfig & {
  sink?: ProjectOpsSink;
  sinks?: ProjectOpsSink[];
};

function normalizeSummary(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

function normalizeHealthSeverity(status: CapstanHealthSnapshot["status"]): OpsSeverity {
  switch (status) {
    case "healthy":
      return "info";
    case "degraded":
      return "warning";
    case "unhealthy":
      return "error";
  }
}

function resolveStorePath(options: ProjectOpsSinkOptions): string {
  if (options.storePath) {
    return resolve(options.storePath);
  }

  if (options.storeDir) {
    return resolve(options.storeDir, DEFAULT_OPS_STORE_FILE);
  }

  return resolve(options.rootDir, DEFAULT_OPS_STORE_DIR, DEFAULT_OPS_STORE_FILE);
}

function deriveIncidentFingerprint(event: CapstanOpsEvent): string | undefined {
  if (event.incidentFingerprint) {
    return event.incidentFingerprint;
  }

  switch (event.kind) {
    case "request":
      if (event.phase !== "end" || !event.data?.status || event.data.status < 400) {
        return undefined;
      }
      return `request:${event.data.method}:${event.data.path}:${Math.floor(event.data.status / 100)}xx`;
    case "capability":
      if (event.phase !== "end" || !event.data?.status || event.data.status < 400) {
        return undefined;
      }
      return `capability:${event.data.method}:${event.data.path}:${Math.floor(event.data.status / 100)}xx`;
    case "policy":
      if (!event.data?.policy) {
        return undefined;
      }
      return `policy:${event.data.policy}:${event.data.effect}`;
    case "approval":
      if (!event.data?.approvalId) {
        return undefined;
      }
      return `approval:${event.data.approvalId}`;
    case "health":
      return event.data.snapshot.status === "healthy"
        ? undefined
        : `health:${event.data.snapshot.status}`;
  }
}

function deriveSeverity(event: CapstanOpsEvent): OpsSeverity {
  switch (event.kind) {
    case "request":
      if (event.phase === "end") {
        const status = event.data?.status ?? 0;
        if (status >= 500) return "error";
        if (status >= 400) return "warning";
      }
      return "info";
    case "capability":
      if (event.phase === "end") {
        const status = event.data?.status ?? 0;
        if (status >= 500) return "error";
        if (status >= 400) return "warning";
        if (event.data?.outcome === "approval_required") {
          return "warning";
        }
      }
      return "info";
    case "policy":
      return event.data?.effect === "allow" ? "info" : "warning";
    case "approval":
      if (event.phase === "requested") {
        return "warning";
      }
      return event.data?.status === "denied" ? "warning" : "info";
    case "health":
      return normalizeHealthSeverity(event.data.snapshot.status);
  }
}

function deriveStatus(event: CapstanOpsEvent): string {
  switch (event.kind) {
    case "request":
      if (event.phase === "start") {
        return "started";
      }
      return (event.data?.status ?? 0) >= 400
        ? "error"
        : "ok";
    case "capability":
      if (event.phase === "start") {
        return "started";
      }
      return event.data?.outcome ?? ((event.data?.status ?? 0) >= 400 ? "error" : "ok");
    case "policy":
      return event.data?.effect ?? "ok";
    case "approval":
      return event.phase === "requested"
        ? "pending"
        : event.data?.status ?? "resolved";
    case "health":
      return event.data.snapshot.status;
  }
}

function deriveTarget(event: CapstanOpsEvent): OpsTarget {
  switch (event.kind) {
    case "request":
      return "runtime";
    case "capability":
      return "capability";
    case "policy":
      return "policy";
    case "approval":
      return "approval";
    case "health":
      return "ops";
  }
}

function deriveSummary(event: CapstanOpsEvent): string {
  switch (event.kind) {
    case "request":
      return event.phase === "start"
        ? `${event.data?.method ?? "REQUEST"} ${event.data?.path ?? "?"} started`
        : `${event.data?.method ?? "REQUEST"} ${event.data?.path ?? "?"} returned ${event.data?.status ?? "unknown"}`;
    case "capability":
      return event.phase === "start"
        ? `${event.data?.capability ?? "capability"} for ${event.data?.path ?? "?"} started`
        : `${event.data?.capability ?? "capability"} for ${event.data?.path ?? "?"} ${event.data?.outcome ?? "completed"}`;
    case "policy":
      return `Policy ${event.data?.policy ?? "unknown"} resolved to ${event.data?.effect ?? "unknown"}`;
    case "approval":
      return event.phase === "requested"
        ? `Approval ${event.data?.approvalId ?? "unknown"} requested`
        : `Approval ${event.data?.approvalId ?? "unknown"} ${event.data?.status ?? "resolved"}`;
    case "health":
      return `Health snapshot is ${event.data.snapshot.status}`;
  }
}

function deriveTitle(event: CapstanOpsEvent): string {
  switch (event.kind) {
    case "request":
      return "HTTP Request";
    case "capability":
      return "Capability Invocation";
    case "policy":
      return "Policy Decision";
    case "approval":
      return "Approval Workflow";
    case "health":
      return "Health Snapshot";
  }
}

function buildTags(event: CapstanOpsEvent): string[] {
  const tags = new Set<string>([
    `kind:${event.kind}`,
    `phase:${event.phase}`,
  ]);

  if (event.requestId) {
    tags.add("request");
  }
  if (event.traceId) {
    tags.add("trace");
  }
  if (event.kind === "health") {
    tags.add(`health:${event.data.snapshot.status}`);
  }
  for (const tag of event.tags ?? []) {
    if (tag.trim().length > 0) {
      tags.add(tag);
    }
  }

  return [...tags].sort();
}

function buildScope(event: CapstanOpsEvent): Record<string, string> {
  const scope: Record<string, string> = {};

  if (event.appName) {
    scope.app = event.appName;
  }
  if (event.requestId) {
    scope.requestId = event.requestId;
  }
  if (event.traceId) {
    scope.traceId = event.traceId;
  }

  switch (event.kind) {
    case "request":
      if (event.data?.path) scope.route = event.data.path;
      if (event.data?.method) scope.method = event.data.method;
      break;
    case "capability":
      if (event.data?.path) scope.route = event.data.path;
      if (event.data?.method) scope.method = event.data.method;
      if (event.data?.capability) scope.capability = event.data.capability;
      if (event.data?.resource) scope.resource = event.data.resource;
      break;
    case "policy":
      if (event.data?.policy) scope.policy = event.data.policy;
      break;
    case "approval":
      if (event.data?.approvalId) scope.approvalId = event.data.approvalId;
      if (event.data?.path) scope.route = event.data.path;
      if (event.data?.method) scope.method = event.data.method;
      if (event.data?.policy) scope.policy = event.data.policy;
      break;
    case "health":
      scope.target = "ops";
      break;
  }

  return scope;
}

function buildMetadata(event: CapstanOpsEvent): Record<string, unknown> {
  return {
    source: event.source ?? "capstan",
    capstanKind: event.kind,
    capstanPhase: event.phase,
    ...(event.incidentFingerprint ? { incidentFingerprint: event.incidentFingerprint } : {}),
    ...(event.tags ? { eventTags: [...event.tags] } : {}),
    ...(event.data ? { data: event.data } : {}),
  };
}

function deriveIncidentStatus(event: CapstanOpsEvent): "open" | "resolved" | undefined {
  if (event.kind === "approval") {
    return event.phase === "resolved" ? "resolved" : "open";
  }

  const severity = deriveSeverity(event);
  if (severity === "warning" || severity === "error") {
    return "open";
  }

  return undefined;
}

function readEventReason(event: CapstanOpsEvent): string | undefined {
  switch (event.kind) {
    case "policy":
    case "approval":
      return typeof event.data?.reason === "string" ? event.data.reason : undefined;
    default:
      return undefined;
  }
}

function mapEventToOpsRecord(event: CapstanOpsEvent): OpsRecordEventInput {
  const severity = deriveSeverity(event);
  const fingerprint = deriveIncidentFingerprint(event);
  const summary = deriveSummary(event);

  return {
    id: event.id,
    kind: `${event.kind}.${event.phase}`,
    timestamp: event.timestamp,
    severity,
    status: deriveStatus(event),
    target: deriveTarget(event),
    scope: buildScope(event),
    title: deriveTitle(event),
    summary,
    message: normalizeSummary(
      readEventReason(event),
      summary,
    ),
    ...(fingerprint ? { fingerprint } : {}),
    tags: buildTags(event),
    correlation: {
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.traceId ? { traceId: event.traceId } : {}),
    },
    metadata: buildMetadata(event),
  };
}

function mapIncidentToOpsRecord(event: CapstanOpsEvent): OpsRecordIncidentInput | undefined {
  const fingerprint = deriveIncidentFingerprint(event);
  if (!fingerprint) {
    return undefined;
  }

  const severity = deriveSeverity(event);
  const status = deriveIncidentStatus(event);
  if (!status) {
    return undefined;
  }

  const summary = deriveSummary(event);
  return {
    fingerprint,
    kind: `${event.kind}.${event.phase}`,
    timestamp: event.timestamp,
    severity,
    status,
    title: deriveTitle(event),
    summary,
    target: deriveTarget(event),
    scope: buildScope(event),
    tags: buildTags(event),
    correlation: {
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.traceId ? { traceId: event.traceId } : {}),
    },
    metadata: buildMetadata(event),
  };
}

function mapSnapshotToOpsRecord(event: CapstanOpsEvent): OpsCaptureSnapshotInput | undefined {
  if (event.kind !== "health") {
    return undefined;
  }

  const snapshot = event.data.snapshot;
  const summary = normalizeSummary(
    snapshot.notes?.join(" "),
    `Health snapshot is ${snapshot.status}`,
  );

  return {
    timestamp: event.timestamp,
    health: snapshot.status,
    summary,
    signals:
      snapshot.status === "healthy"
        ? []
        : [
            {
              key: `health:${snapshot.status}`,
              source: "snapshot",
              severity: normalizeHealthSeverity(snapshot.status),
              status: snapshot.status,
              title: "Health Snapshot",
              summary,
              kind: "health.snapshot",
              scope: buildScope(event),
              metadata: {
                requestCount: snapshot.requestCount ?? 0,
                errorCount: snapshot.errorCount ?? 0,
                warningCount: snapshot.warningCount ?? 0,
                activeIncidentCount: snapshot.activeIncidentCount ?? 0,
              },
            },
          ],
    scope: buildScope(event),
    metadata: {
      requestCount: snapshot.requestCount ?? 0,
      errorCount: snapshot.errorCount ?? 0,
      warningCount: snapshot.warningCount ?? 0,
      activeIncidentCount: snapshot.activeIncidentCount ?? 0,
      ...(snapshot.mode ? { mode: snapshot.mode } : {}),
      ...(snapshot.routeCount !== undefined ? { routeCount: snapshot.routeCount } : {}),
      ...(snapshot.apiRouteCount !== undefined ? { apiRouteCount: snapshot.apiRouteCount } : {}),
      ...(snapshot.pageRouteCount !== undefined ? { pageRouteCount: snapshot.pageRouteCount } : {}),
      ...(snapshot.policyCount !== undefined ? { policyCount: snapshot.policyCount } : {}),
      ...(snapshot.approvalCount !== undefined ? { approvalCount: snapshot.approvalCount } : {}),
      ...(snapshot.recentWindowMs !== undefined ? { recentWindowMs: snapshot.recentWindowMs } : {}),
    },
  };
}

export function createProjectOpsSink(
  options: ProjectOpsSinkOptions,
): ProjectOpsSink {
  const store = new SqliteOpsStore({
    path: resolveStorePath(options),
  });
  const runtime = createSemanticOpsRuntime({
    store,
    ...(options.appName ? { serviceName: options.appName } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
  });

  return {
    async recordEvent(event: CapstanOpsEvent) {
      const mappedEvent = mapEventToOpsRecord(event);
      await runtime.recordEvent(mappedEvent);

      const incident = mapIncidentToOpsRecord(event);
      if (incident) {
        await runtime.recordIncident(incident);
      }

      const snapshot = mapSnapshotToOpsRecord(event);
      if (snapshot) {
        await runtime.captureSnapshot(snapshot);
      }
    },
    async close() {
      await store.close();
    },
  };
}

export function resolveProjectOpsConfig(
  base: CapstanOpsConfig | undefined,
  options: ProjectOpsSinkOptions & { source?: string },
): ResolvedProjectOpsConfig | undefined {
  if (base?.enabled === false) {
    return base as ResolvedProjectOpsConfig;
  }

  const appName = base?.appName ?? options.appName;
  const source = base?.source ?? options.source ?? "capstan";
  const resolvedBase = (base ?? {}) as ResolvedProjectOpsConfig;

  if (resolvedBase.sink || (resolvedBase.sinks && resolvedBase.sinks.length > 0)) {
    return {
      ...resolvedBase,
      ...(appName ? { appName } : {}),
      source,
    };
  }

  try {
    const sink = createProjectOpsSink({
      rootDir: options.rootDir,
      ...(appName ? { appName } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.storeDir ? { storeDir: options.storeDir } : {}),
      ...(options.storePath ? { storePath: options.storePath } : {}),
    });
    return {
      ...resolvedBase,
      ...(appName ? { appName } : {}),
      source,
      sink,
    };
  } catch (error) {
    console.warn(
      "[capstan] Failed to initialize project ops sink:",
      error instanceof Error ? error.message : error,
    );
    return {
      ...resolvedBase,
      ...(appName ? { appName } : {}),
      source,
    };
  }
}
