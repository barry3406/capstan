import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type {
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphPathSet,
  HarnessGraphScope,
} from "./types.js";
import { encodeGraphPathSegment, formatHarnessGraphScopeKey } from "./utils.js";

const MAX_GRAPH_PATH_SEGMENT_LENGTH = 80;

const HARNESS_ROOT = ".capstan/harness";

export function buildHarnessGraphPaths(rootDir: string): HarnessGraphPathSet {
  const graphRootDir = resolve(rootDir, HARNESS_ROOT, "graph");
  return {
    graphRootDir,
    scopesDir: resolve(graphRootDir, "scopes"),
    nodesDir: resolve(graphRootDir, "nodes"),
    edgesDir: resolve(graphRootDir, "edges"),
    projectionsDir: resolve(graphRootDir, "projections"),
  };
}

export function resolveHarnessGraphScopeFilePath(
  paths: HarnessGraphPathSet,
  scope: HarnessGraphScope,
): string {
  return resolve(
    paths.scopesDir,
    `${encodeGraphPathSegmentForFilePath(formatHarnessGraphScopeKey(scope))}.json`,
  );
}

export function resolveHarnessGraphNodeFilePath(
  paths: HarnessGraphPathSet,
  node: HarnessGraphNodeRecord,
): string {
  return resolve(
    paths.nodesDir,
    encodeGraphPathSegmentForFilePath(formatHarnessGraphScopeKey(node.scope)),
    encodeGraphPathSegmentForFilePath(node.kind),
    `${encodeGraphPathSegmentForFilePath(encodeGraphPathSegment(node.id))}.json`,
  );
}

export function resolveHarnessGraphEdgeFilePath(
  paths: HarnessGraphPathSet,
  edge: HarnessGraphEdgeRecord,
): string {
  return resolve(
    paths.edgesDir,
    encodeGraphPathSegmentForFilePath(formatHarnessGraphScopeKey(edge.scope)),
    encodeGraphPathSegmentForFilePath(edge.kind),
    `${encodeGraphPathSegmentForFilePath(encodeGraphPathSegment(edge.id))}.json`,
  );
}

export function encodeGraphPathSegmentForFilePath(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Harness graph path segment must be a non-empty string");
  }
  if (normalized.length <= MAX_GRAPH_PATH_SEGMENT_LENGTH) {
    return normalized;
  }
  const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 16);
  const prefix = normalized.slice(0, MAX_GRAPH_PATH_SEGMENT_LENGTH - 18).replace(/_+$/, "");
  return `${prefix || "segment"}__${digest}`;
}
