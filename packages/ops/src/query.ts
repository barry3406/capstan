import type {
  OpsEventFilter,
  OpsEventRecord,
  OpsHealthStatus,
  OpsIncidentFilter,
  OpsIncidentRecord,
  OpsQueryIndex,
  OpsSnapshotFilter,
  OpsSnapshotRecord,
  OpsStore,
} from "./contracts.js";
import {
  scopeMatchesFilters,
  sortByTimestamp,
  tagsContainAll,
} from "./utils.js";

function applyLimit<T>(records: T[], limit: number | undefined): T[] {
  return typeof limit === "number" && limit >= 0
    ? records.slice(0, limit)
    : records;
}

function matchesTimeWindow(
  timestamp: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (from && timestamp < from) {
    return false;
  }
  if (to && timestamp > to) {
    return false;
  }
  return true;
}

export function filterOpsEvents(
  records: OpsEventRecord[],
  filter: OpsEventFilter | undefined,
): OpsEventRecord[] {
  const filtered = records.filter((record) => {
    if (filter?.ids && !filter.ids.includes(record.id)) {
      return false;
    }
    if (filter?.kinds && !filter.kinds.includes(record.kind)) {
      return false;
    }
    if (filter?.severities && !filter.severities.includes(record.severity)) {
      return false;
    }
    if (filter?.statuses && !filter.statuses.includes(record.status)) {
      return false;
    }
    if (filter?.targets && !filter.targets.includes(record.target)) {
      return false;
    }
    if (!scopeMatchesFilters(record.scope, filter?.scopes)) {
      return false;
    }
    if (!tagsContainAll(record.tags, filter?.tags)) {
      return false;
    }
    return matchesTimeWindow(record.timestamp, filter?.from, filter?.to);
  });

  return applyLimit(sortByTimestamp(filtered, filter?.sort), filter?.limit);
}

export function filterOpsIncidents(
  records: OpsIncidentRecord[],
  filter: OpsIncidentFilter | undefined,
): OpsIncidentRecord[] {
  const filtered = records.filter((record) => {
    if (filter?.ids && !filter.ids.includes(record.id)) {
      return false;
    }
    if (filter?.fingerprints && !filter.fingerprints.includes(record.fingerprint)) {
      return false;
    }
    if (filter?.kinds && !filter.kinds.includes(record.kind)) {
      return false;
    }
    if (filter?.severities && !filter.severities.includes(record.severity)) {
      return false;
    }
    if (filter?.statuses && !filter.statuses.includes(record.status)) {
      return false;
    }
    if (filter?.targets && (!record.target || !filter.targets.includes(record.target))) {
      return false;
    }
    if (!scopeMatchesFilters(record.scope, filter?.scopes)) {
      return false;
    }
    if (!tagsContainAll(record.tags ?? [], filter?.tags)) {
      return false;
    }
    return matchesTimeWindow(record.timestamp, filter?.from, filter?.to);
  });

  return applyLimit(sortByTimestamp(filtered, filter?.sort), filter?.limit);
}

export function filterOpsSnapshots(
  records: OpsSnapshotRecord[],
  filter: OpsSnapshotFilter | undefined,
): OpsSnapshotRecord[] {
  const filtered = records.filter((record) => {
    if (filter?.ids && !filter.ids.includes(record.id)) {
      return false;
    }
    if (filter?.health && !filter.health.includes(record.health)) {
      return false;
    }
    if (!scopeMatchesFilters(record.scope ?? {}, filter?.scopes)) {
      return false;
    }
    return matchesTimeWindow(record.timestamp, filter?.from, filter?.to);
  });

  return applyLimit(sortByTimestamp(filtered, filter?.sort), filter?.limit);
}

export function createOpsQuery(store: OpsStore) {
  return {
    events(filter?: OpsEventFilter): OpsEventRecord[] {
      return store.listEvents(filter);
    },
    incidents(filter?: OpsIncidentFilter): OpsIncidentRecord[] {
      return store.listIncidents(filter);
    },
    snapshots(filter?: OpsSnapshotFilter): OpsSnapshotRecord[] {
      return store.listSnapshots(filter);
    },
  };
}

export function createOpsQueryIndex(store: OpsStore): OpsQueryIndex {
  const events = store.listEvents({ sort: "asc" });
  const incidents = store.listIncidents({ sort: "asc" });
  const snapshots = store.listSnapshots({ sort: "asc" });

  const eventsBySeverity: OpsQueryIndex["eventsBySeverity"] = {};
  const eventsByStatus: OpsQueryIndex["eventsByStatus"] = {};
  const incidentsBySeverity: OpsQueryIndex["incidentsBySeverity"] = {};
  const incidentsByStatus: OpsQueryIndex["incidentsByStatus"] = {};
  const snapshotsByHealth: Partial<Record<OpsHealthStatus, number>> = {};

  for (const event of events) {
    eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] ?? 0) + 1;
    eventsByStatus[event.status] = (eventsByStatus[event.status] ?? 0) + 1;
  }

  for (const incident of incidents) {
    incidentsBySeverity[incident.severity] =
      (incidentsBySeverity[incident.severity] ?? 0) + 1;
    incidentsByStatus[incident.status] =
      (incidentsByStatus[incident.status] ?? 0) + 1;
  }

  for (const snapshot of snapshots) {
    snapshotsByHealth[snapshot.health] = (snapshotsByHealth[snapshot.health] ?? 0) + 1;
  }

  return {
    totalEvents: events.length,
    totalIncidents: incidents.length,
    totalSnapshots: snapshots.length,
    eventsBySeverity,
    eventsByStatus,
    incidentsBySeverity,
    incidentsByStatus,
    snapshotsByHealth,
  };
}
