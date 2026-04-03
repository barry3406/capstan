import type {
  OpsHealthSignal,
  OpsHealthStatus,
  OpsOverview,
  OpsQueryIndex,
  OpsStore,
} from "./contracts.js";
import { createOpsQuery } from "./query.js";
import {
  createHealthSignalFromEvent,
  createHealthSignalFromIncident,
  dedupeSignals,
  nextHealthStatus,
} from "./utils.js";

function summarizeHealth(status: OpsHealthStatus, signals: OpsHealthSignal[]): string {
  if (signals.length === 0) {
    return status === "healthy"
      ? "No active degradation signals detected."
      : "Health degraded without specific signals.";
  }

  const highest = signals[0]!;
  switch (status) {
    case "healthy":
      return "Runtime is healthy.";
    case "degraded":
      return `Degraded: ${highest.summary}`;
    case "unhealthy":
      return `Unhealthy: ${highest.summary}`;
  }
}

export function deriveOpsHealthStatus(
  store: OpsStore,
  options?: {
    recentEventLimit?: number;
    recentIncidentLimit?: number;
  },
): {
  status: OpsHealthStatus;
  summary: string;
  signals: OpsHealthSignal[];
} {
  const query = createOpsQuery(store);
  const recentEvents = query.events({
    sort: "desc",
    limit: options?.recentEventLimit ?? 25,
  });
  const recentIncidents = query.incidents({
    sort: "desc",
    limit: options?.recentIncidentLimit ?? 25,
    statuses: ["open", "acknowledged", "suppressed"],
  });
  const latestSnapshot = query.snapshots({
    sort: "desc",
    limit: 1,
  })[0];

  const signals: OpsHealthSignal[] = [];
  let status: OpsHealthStatus = latestSnapshot?.health ?? "healthy";

  if (latestSnapshot) {
    signals.push(...latestSnapshot.signals);
  }

  for (const incident of recentIncidents) {
    const signal = createHealthSignalFromIncident(incident);
    signals.push(signal);
    status = nextHealthStatus(status, signal.status);
  }

  for (const event of recentEvents) {
    if (event.severity === "warning" || event.severity === "error" || event.severity === "critical") {
      const signal = createHealthSignalFromEvent(
        event.kind,
        event.severity,
        event.summary ?? event.message ?? `${event.kind} reported ${event.severity}`,
        event.scope,
        event.metadata,
      );
      signals.push(signal);
      status = nextHealthStatus(status, signal.status);
    }
  }

  const dedupedSignals = dedupeSignals(signals);
  return {
    status,
    summary: summarizeHealth(status, dedupedSignals),
    signals: dedupedSignals,
  };
}

export function createOpsOverview(
  query: ReturnType<typeof createOpsQuery>,
  index: OpsQueryIndex,
): OpsOverview {
  const recentEvents = query.events({ sort: "asc", limit: 25 });
  const recentIncidents = query.incidents({ sort: "asc", limit: 25 });
  const recentSnapshots = query.snapshots({ sort: "asc", limit: 10 });
  const activeIncidents = query.incidents({
    sort: "asc",
    statuses: ["open", "acknowledged", "suppressed"],
  });
  const activeCriticalIncidents = activeIncidents.filter((incident) => incident.severity === "critical");

  const open = index.incidentsByStatus.open ?? 0;
  const acknowledged = index.incidentsByStatus.acknowledged ?? 0;
  const suppressed = index.incidentsByStatus.suppressed ?? 0;
  const resolved = index.incidentsByStatus.resolved ?? 0;

  let status: OpsHealthStatus = "healthy";
  if (activeCriticalIncidents.length > 0) {
    status = "unhealthy";
  } else if (
    (index.eventsBySeverity.error ?? 0) > 0
    || (index.eventsBySeverity.warning ?? 0) > 0
    || activeIncidents.length > 0
  ) {
    status = "degraded";
  }

  const latestSnapshot = query.snapshots({
    sort: "desc",
    limit: 1,
  })[0];
  if (latestSnapshot) {
    status = nextHealthStatus(status, latestSnapshot.health);
  }

  const signals = dedupeSignals([
    ...(latestSnapshot?.signals ?? []),
    ...activeIncidents.map(createHealthSignalFromIncident),
  ]);

  return {
    totals: {
      events: index.totalEvents,
      incidents: index.totalIncidents,
      snapshots: index.totalSnapshots,
    },
    incidents: {
      open,
      acknowledged,
      suppressed,
      resolved,
    },
    health: {
      status,
      summary: summarizeHealth(status, signals),
      signals,
    },
    windows: {
      recentEvents,
      recentIncidents,
      recentSnapshots,
    },
    index,
  };
}
