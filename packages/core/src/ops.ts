/**
 * Capstan Ops
 *
 * A small semantic ops layer for runtime code. The goal is to capture
 * structured lifecycle, policy, approval, capability, and health data
 * without coupling the core runtime to any specific observability backend.
 */

export type CapstanOpsEventKind =
  | "request"
  | "capability"
  | "policy"
  | "approval"
  | "health";

export type CapstanOpsEventPhase =
  | "start"
  | "end"
  | "decision"
  | "requested"
  | "resolved"
  | "snapshot";

export interface CapstanOpsEventBase {
  id: string;
  kind: CapstanOpsEventKind;
  phase: CapstanOpsEventPhase;
  timestamp: string;
  appName?: string;
  source?: string;
  requestId?: string;
  traceId?: string;
  incidentFingerprint?: string;
  tags?: string[];
  data?: Record<string, unknown>;
}

export interface CapstanRequestLifecycleEvent extends CapstanOpsEventBase {
  kind: "request";
  phase: "start" | "end";
  data?: {
    method: string;
    path: string;
    status?: number;
    durationMs?: number;
    userAgent?: string;
  };
}

export interface CapstanCapabilityInvocationEvent extends CapstanOpsEventBase {
  kind: "capability";
  phase: "start" | "end";
  data?: {
    method: string;
    path: string;
    capability?: string;
    resource?: string;
    status?: number;
    durationMs?: number;
    outcome?: "success" | "failure" | "approval_required";
  };
}

export interface CapstanPolicyDecisionEvent extends CapstanOpsEventBase {
  kind: "policy";
  phase: "decision";
  data?: {
    policy: string;
    effect: "allow" | "deny" | "approve" | "redact";
    reason?: string;
    inputKind?: string;
  };
}

export interface CapstanApprovalEvent extends CapstanOpsEventBase {
  kind: "approval";
  phase: "requested" | "resolved";
  data?: {
    approvalId: string;
    method: string;
    path: string;
    policy: string;
    reason?: string;
    status?: "pending" | "approved" | "denied";
    resolvedBy?: string;
  };
}

export interface CapstanHealthSnapshot {
  generatedAt: string;
  appName?: string;
  status: "healthy" | "degraded" | "unhealthy";
  mode?: "development" | "production";
  routeCount?: number;
  apiRouteCount?: number;
  pageRouteCount?: number;
  policyCount?: number;
  approvalCount?: number;
  requestCount?: number;
  errorCount?: number;
  warningCount?: number;
  activeIncidentCount?: number;
  recentWindowMs?: number;
  notes?: string[];
}

export interface CapstanHealthSnapshotEvent extends CapstanOpsEventBase {
  kind: "health";
  phase: "snapshot";
  data: {
    snapshot: CapstanHealthSnapshot;
  };
}

export type CapstanOpsEvent =
  | CapstanRequestLifecycleEvent
  | CapstanCapabilityInvocationEvent
  | CapstanPolicyDecisionEvent
  | CapstanApprovalEvent
  | CapstanHealthSnapshotEvent;

export interface CapstanOpsQuery {
  kinds?: CapstanOpsEventKind[];
  phases?: CapstanOpsEventPhase[];
  requestId?: string;
  traceId?: string;
  source?: string;
  incidentFingerprint?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
}

export interface CapstanOpsIncident {
  fingerprint: string;
  title: string;
  severity: "info" | "warning" | "error";
  status: "open" | "resolved";
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  eventIds: string[];
  requestIds: string[];
  traceIds: string[];
  kinds: CapstanOpsEventKind[];
  summary: string;
  recommendation?: string;
}

export interface CapstanOpsStore {
  append(event: CapstanOpsEvent): Promise<void>;
  list(query?: CapstanOpsQuery): Promise<CapstanOpsEvent[]>;
  clear(): Promise<void>;
}

export interface CapstanOpsSink {
  recordEvent(event: CapstanOpsEvent): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface CapstanOpsRuntime {
  appName?: string;
  source?: string;
  store: CapstanOpsStore;
  recordEvent(event: CapstanOpsEvent): Promise<void>;
  queryEvents(query?: CapstanOpsQuery): Promise<CapstanOpsEvent[]>;
  queryIncidents(query?: CapstanOpsQuery): Promise<CapstanOpsIncident[]>;
  snapshotHealth(input?: CapstanOpsHealthSnapshotInput): Promise<CapstanHealthSnapshot>;
}

export interface CapstanOpsHealthSnapshotInput {
  appName?: string;
  mode?: "development" | "production";
  routeCount?: number;
  apiRouteCount?: number;
  pageRouteCount?: number;
  policyCount?: number;
  approvalCount?: number;
  recentWindowMs?: number;
  now?: string | Date;
  notes?: string[];
}

export interface CapstanOpsConfig {
  enabled?: boolean;
  appName?: string;
  source?: string;
  store?: CapstanOpsStore;
  runtime?: CapstanOpsRuntime;
  recentWindowMs?: number;
  retentionLimit?: number;
  sink?: CapstanOpsSink;
  sinks?: CapstanOpsSink[];
}

export interface CapstanOpsContext {
  enabled: boolean;
  runtime: CapstanOpsRuntime;
  store: CapstanOpsStore;
  recordRequestStart(event: Omit<CapstanRequestLifecycleEvent, "id" | "kind" | "phase" | "timestamp">): Promise<void>;
  recordRequestEnd(event: Omit<CapstanRequestLifecycleEvent, "id" | "kind" | "phase" | "timestamp">): Promise<void>;
  recordCapabilityInvocation(event: Omit<CapstanCapabilityInvocationEvent, "id" | "kind" | "phase" | "timestamp"> & { phase: "start" | "end" }): Promise<void>;
  recordPolicyDecision(event: Omit<CapstanPolicyDecisionEvent, "id" | "kind" | "phase" | "timestamp">): Promise<void>;
  recordApprovalRequested(event: Omit<CapstanApprovalEvent, "id" | "kind" | "phase" | "timestamp">): Promise<void>;
  recordApprovalResolved(event: Omit<CapstanApprovalEvent, "id" | "kind" | "phase" | "timestamp">): Promise<void>;
  recordHealthSnapshot(input?: CapstanOpsHealthSnapshotInput): Promise<CapstanHealthSnapshot>;
  queryEvents(query?: CapstanOpsQuery): Promise<CapstanOpsEvent[]>;
  queryIncidents(query?: CapstanOpsQuery): Promise<CapstanOpsIncident[]>;
}

export interface BuildOpsContextOptions {
  config?: CapstanOpsConfig;
}

function randomId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toIsoDate(value?: string | Date): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function clampLimit(limit?: number): number | undefined {
  if (typeof limit !== "number" || Number.isNaN(limit) || limit <= 0) {
    return undefined;
  }

  return Math.min(Math.floor(limit), 10_000);
}

function isEventWindowMatch(event: CapstanOpsEvent, query: CapstanOpsQuery): boolean {
  if (query.kinds && !query.kinds.includes(event.kind)) {
    return false;
  }
  if (query.phases && !query.phases.includes(event.phase)) {
    return false;
  }
  if (query.requestId && event.requestId !== query.requestId) {
    return false;
  }
  if (query.traceId && event.traceId !== query.traceId) {
    return false;
  }
  if (query.source && event.source !== query.source) {
    return false;
  }
  if (query.incidentFingerprint) {
    const fingerprint = event.incidentFingerprint ?? createIncidentFingerprint(event);
    if (fingerprint !== query.incidentFingerprint) {
      return false;
    }
  }

  const from = toIsoDate(query.from);
  const to = toIsoDate(query.to);
  if (from && event.timestamp < from) {
    return false;
  }
  if (to && event.timestamp > to) {
    return false;
  }

  return true;
}

function normalizeIncidentSeverity(event: CapstanOpsEvent): "info" | "warning" | "error" {
  if (event.kind === "request" && event.phase === "end" && event.data?.status) {
    return event.data.status >= 500 ? "error" : event.data.status >= 400 ? "warning" : "info";
  }

  if (event.kind === "capability" && event.phase === "end" && event.data?.status) {
    return event.data.status >= 500 ? "error" : event.data.status >= 400 ? "warning" : "info";
  }

  if (event.kind === "policy") {
    return event.data?.effect === "deny" ? "warning" : "info";
  }

  if (event.kind === "approval") {
    return event.phase === "requested" ? "warning" : "info";
  }

  return "info";
}

function createIncidentFingerprint(event: CapstanOpsEvent): string | undefined {
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

function summarizeIncident(event: CapstanOpsEvent, count: number): string {
  switch (event.kind) {
    case "request":
      return `${event.data?.method ?? "REQUEST"} ${event.data?.path ?? "?"} returned ${event.data?.status ?? "unknown"} (${count} occurrence${count === 1 ? "" : "s"})`;
    case "capability":
      return `${event.data?.method ?? "CAPABILITY"} ${event.data?.path ?? "?"} failed with ${event.data?.status ?? "unknown"} (${count} occurrence${count === 1 ? "" : "s"})`;
    case "policy":
      return `Policy ${event.data?.policy ?? "unknown"} resolved to ${event.data?.effect ?? "unknown"} (${count} occurrence${count === 1 ? "" : "s"})`;
    case "approval":
      return `Approval ${event.data?.approvalId ?? "unknown"} moved to ${event.phase} (${count} occurrence${count === 1 ? "" : "s"})`;
    case "health":
      return `Health snapshot reported ${event.data.snapshot.status} (${count} occurrence${count === 1 ? "" : "s"})`;
  }
}

function recommendationForIncident(event: CapstanOpsEvent): string | undefined {
  switch (event.kind) {
    case "request":
      if (event.data?.status && event.data.status >= 500) {
        return "Inspect the route handler, recent deploys, and associated logs for the failing request.";
      }
      if (event.data?.status && event.data.status >= 400) {
        return "Review auth, validation, or policy decisions for the affected route.";
      }
      return undefined;
    case "capability":
      return "Inspect the capability handler and the upstream request context.";
    case "policy":
      return event.data?.effect === "deny"
        ? "Adjust the policy, auth state, or approval path for the denied operation."
        : "Review the approval workflow associated with the policy.";
    case "approval":
      return "Review the approval queue or the underlying handler that requested approval.";
    case "health":
      return "Use the health snapshot to inspect recent incidents, error bursts, and open approvals.";
  }
}

function buildEventId(): string {
  return randomId();
}

function collectSinks(options: CapstanOpsConfig): CapstanOpsSink[] {
  const sinks: CapstanOpsSink[] = [];
  if (options.sink) {
    sinks.push(options.sink);
  }
  if (options.sinks && options.sinks.length > 0) {
    sinks.push(...options.sinks);
  }
  return sinks;
}

async function emitToSinks(
  sinks: CapstanOpsSink[],
  event: CapstanOpsEvent,
): Promise<void> {
  if (sinks.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    sinks.map(async (sink) => {
      await sink.recordEvent(event);
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn(
        "[capstan] ops sink failed to record event:",
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  }
}

class RuntimeOpsStore implements CapstanOpsStore {
  private events: CapstanOpsEvent[] = [];

  constructor(private readonly retentionLimit = 5_000) {}

  async append(event: CapstanOpsEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > this.retentionLimit) {
      this.events.splice(0, this.events.length - this.retentionLimit);
    }
  }

  async list(query: CapstanOpsQuery = {}): Promise<CapstanOpsEvent[]> {
    const limit = clampLimit(query.limit);
    const filtered = this.events.filter((event) => isEventWindowMatch(event, query));
    return typeof limit === "number" ? filtered.slice(-limit) : filtered;
  }

  async clear(): Promise<void> {
    this.events = [];
  }
}

function normalizeEvent<T extends CapstanOpsEventBase>(
  event: T,
  defaults: Pick<CapstanOpsConfig, "appName" | "source">,
): T {
  return {
    ...event,
    id: event.id || buildEventId(),
    timestamp: event.timestamp || new Date().toISOString(),
    ...(event.appName ?? defaults.appName
      ? { appName: event.appName ?? defaults.appName }
      : {}),
    ...(event.source ?? defaults.source ?? "capstan"
      ? { source: event.source ?? defaults.source ?? "capstan" }
      : {}),
  };
}

function buildIncidentLedger(events: CapstanOpsEvent[]): CapstanOpsIncident[] {
  const buckets = new Map<string, { first: CapstanOpsEvent; events: CapstanOpsEvent[] }>();

  for (const event of events) {
    const fingerprint = event.incidentFingerprint ?? createIncidentFingerprint(event);
    if (!fingerprint) {
      continue;
    }

    const existing = buckets.get(fingerprint);
    if (existing) {
      existing.events.push(event);
    } else {
      buckets.set(fingerprint, { first: event, events: [event] });
    }
  }

  const incidents: CapstanOpsIncident[] = [];

  for (const [fingerprint, bucket] of buckets) {
    const first = bucket.first;
    const last = bucket.events[bucket.events.length - 1] ?? first;
    const count = bucket.events.length;
    const requestIds = [...new Set(bucket.events.map((event) => event.requestId).filter((value): value is string => typeof value === "string"))];
    const traceIds = [...new Set(bucket.events.map((event) => event.traceId).filter((value): value is string => typeof value === "string"))];
    const recommendation = recommendationForIncident(first);
    const status =
      last.kind === "approval" && last.phase === "resolved"
        ? "resolved"
        : "open";
    incidents.push({
      fingerprint,
      title: summarizeIncident(first, count),
      severity: bucket.events.some((event) => normalizeIncidentSeverity(event) === "error")
        ? "error"
        : bucket.events.some((event) => normalizeIncidentSeverity(event) === "warning")
          ? "warning"
          : "info",
      status,
      firstSeenAt: first.timestamp,
      lastSeenAt: last.timestamp,
      occurrences: count,
      eventIds: bucket.events.map((event) => event.id),
      requestIds,
      traceIds,
      kinds: [...new Set(bucket.events.map((event) => event.kind))],
      summary: summarizeIncident(first, count),
      ...(recommendation ? { recommendation } : {}),
    });
  }

  return incidents.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

function computeHealthStatus(incidents: CapstanOpsIncident[], snapshot: CapstanHealthSnapshot): "healthy" | "degraded" | "unhealthy" {
  if (snapshot.errorCount && snapshot.errorCount > 0) {
    return "unhealthy";
  }

  if (incidents.some((incident) => incident.severity === "error")) {
    return "unhealthy";
  }

  if (snapshot.warningCount && snapshot.warningCount > 0) {
    return "degraded";
  }

  if (incidents.some((incident) => incident.severity === "warning")) {
    return "degraded";
  }

  return "healthy";
}

export function createCapstanOpsRuntime(options: CapstanOpsConfig = {}): CapstanOpsRuntime {
  const store = options.store ?? new RuntimeOpsStore(options.retentionLimit);
  const sinks = collectSinks(options);
  const runtime: CapstanOpsRuntime = {
    ...(options.appName ? { appName: options.appName } : {}),
    source: options.source ?? "capstan",
    store,
    async recordEvent(event) {
      if (options.enabled === false) {
        return;
      }
      const normalized = normalizeEvent(event, options);
      await store.append(normalized);
      await emitToSinks(sinks, normalized);
    },
    async queryEvents(query) {
      return store.list(query);
    },
    async queryIncidents(query) {
      const events = await store.list(query);
      return buildIncidentLedger(events);
    },
    async snapshotHealth(input = {}) {
      const now = toIsoDate(input.now) ?? new Date().toISOString();
      const events = await store.list({
        ...(input.recentWindowMs
          ? { from: new Date(Date.parse(now) - input.recentWindowMs) }
          : {}),
        to: now,
      });
      const incidents = buildIncidentLedger(events);
      const requestCount = events.filter((event) => event.kind === "request" && event.phase === "end").length;
      const errorCount = events.filter((event) => {
        if (event.kind === "request" && event.phase === "end") {
          return (event.data?.status ?? 0) >= 500;
        }
        if (event.kind === "capability" && event.phase === "end") {
          return (event.data?.status ?? 0) >= 500;
        }
        return false;
      }).length;
      const warningCount = events.filter((event) => {
        if (event.kind === "request" && event.phase === "end") {
          const status = event.data?.status ?? 0;
          return status >= 400 && status < 500;
        }
        if (event.kind === "capability" && event.phase === "end") {
          const status = event.data?.status ?? 0;
          return status >= 400 && status < 500;
        }
        if (event.kind === "policy") {
          return event.data?.effect === "approve" || event.data?.effect === "deny";
        }
        return false;
      }).length;

      const snapshot: CapstanHealthSnapshot = {
        generatedAt: now,
        ...(input.appName ?? runtime.appName ? { appName: input.appName ?? runtime.appName } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.routeCount !== undefined ? { routeCount: input.routeCount } : {}),
        ...(input.apiRouteCount !== undefined ? { apiRouteCount: input.apiRouteCount } : {}),
        ...(input.pageRouteCount !== undefined ? { pageRouteCount: input.pageRouteCount } : {}),
        ...(input.policyCount !== undefined ? { policyCount: input.policyCount } : {}),
        ...(input.approvalCount !== undefined ? { approvalCount: input.approvalCount } : {}),
        requestCount,
        errorCount,
        warningCount,
        activeIncidentCount: incidents.filter((incident) => incident.status === "open").length,
        ...(input.recentWindowMs !== undefined ? { recentWindowMs: input.recentWindowMs } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        status: "healthy",
      };
      snapshot.status = computeHealthStatus(incidents, snapshot);

      await runtime.recordEvent({
        id: buildEventId(),
        kind: "health",
        phase: "snapshot",
        timestamp: now,
        ...(snapshot.appName ? { appName: snapshot.appName } : {}),
        ...(runtime.source ? { source: runtime.source } : {}),
        ...(snapshot.status === "healthy"
          ? {}
          : { incidentFingerprint: `health:${snapshot.status}` }),
        data: { snapshot },
      });

      return snapshot;
    },
  };

  return runtime;
}

export function createCapstanOpsContext(options?: CapstanOpsConfig): CapstanOpsContext | undefined {
  if (!options) {
    return undefined;
  }

  const runtime = options.runtime ?? createCapstanOpsRuntime(options);
  const enabled = options.enabled !== false;

  if (!enabled && !options.runtime && !options.store) {
    return undefined;
  }

  return {
    enabled,
    runtime,
    store: runtime.store,
    async recordRequestStart(event) {
      await runtime.recordEvent({
        ...event,
        id: buildEventId(),
        kind: "request",
        phase: "start",
        timestamp: new Date().toISOString(),
        data: event.data ?? {
          method: "UNKNOWN",
          path: "UNKNOWN",
        },
      });
    },
    async recordRequestEnd(event) {
      await runtime.recordEvent({
        ...event,
        id: buildEventId(),
        kind: "request",
        phase: "end",
        timestamp: new Date().toISOString(),
      });
    },
    async recordCapabilityInvocation(event) {
      await runtime.recordEvent({
        ...event,
        id: buildEventId(),
        kind: "capability",
        timestamp: new Date().toISOString(),
      });
    },
    async recordPolicyDecision(event) {
      await runtime.recordEvent({
        ...event,
        id: buildEventId(),
        kind: "policy",
        phase: "decision",
        timestamp: new Date().toISOString(),
      });
    },
    async recordApprovalRequested(event) {
      await runtime.recordEvent({
        ...event,
        id: buildEventId(),
        kind: "approval",
        phase: "requested",
        timestamp: new Date().toISOString(),
      });
    },
    async recordApprovalResolved(event) {
      await runtime.recordEvent({
        ...event,
        id: buildEventId(),
        kind: "approval",
        phase: "resolved",
        timestamp: new Date().toISOString(),
      });
    },
    async recordHealthSnapshot(input) {
      return runtime.snapshotHealth(input);
    },
    async queryEvents(query) {
      return runtime.queryEvents(query);
    },
    async queryIncidents(query) {
      return runtime.queryIncidents(query);
    },
  };
}

export function createRequestIdentity(options: {
  requestId?: string;
  traceId?: string;
  requestHeaderId?: string | null;
  traceHeaderId?: string | null;
} = {}): { requestId: string; traceId: string } {
  return {
    requestId: options.requestId ?? options.requestHeaderId ?? randomId(),
    traceId: options.traceId ?? options.traceHeaderId ?? randomId(),
  };
}
