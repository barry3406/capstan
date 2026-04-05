import type { HarnessContextBlock } from "../types.js";
import type {
  HarnessGraphEdgeQuery,
  HarnessGraphNodeKind,
  HarnessGraphNodeQuery,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessGraphSearchQuery,
  HarnessGraphSearchResult,
} from "./types.js";
import { buildGraphContextBlock } from "./context.js";
import {
  compareTimestampDescendingThenId,
  extractGraphSearchText,
  recencyScore,
  scoreTokenOverlap,
  tokenizeGraphQuery,
} from "./utils.js";

interface GraphReadableStore {
  listNodes?(query?: HarnessGraphNodeQuery): Promise<any[]>;
  listEdges?(query?: HarnessGraphEdgeQuery): Promise<any[]>;
  getNode?(nodeId: string): Promise<any>;
  listGraphNodes?(query?: HarnessGraphNodeQuery): Promise<any[]>;
  listGraphEdges?(query?: HarnessGraphEdgeQuery): Promise<any[]>;
  getGraphNode?(nodeId: string): Promise<any>;
}

type GraphNodeQueryInput = HarnessGraphNodeQuery;

export async function queryHarnessGraph(
  store: GraphReadableStore,
  query: HarnessGraphSearchQuery,
): Promise<HarnessGraphSearchResult[]> {
  const nodes = await readGraphNodes(store, {
    ...(query.scopes?.length ? { scopes: query.scopes } : {}),
    ...(query.kinds?.length ? { kinds: query.kinds } : {}),
  });
  const edges = await readGraphEdges(store, {
    ...(query.scopes?.length ? { scopes: query.scopes } : {}),
  });
  const queryTokens = tokenizeGraphQuery(query.text ?? "");
  const adjacency = buildAdjacency(edges);
  const relatedDistances = query.relatedTo
    ? buildRelatedDistances(query.relatedTo, adjacency)
    : new Map<string, number>();

  const results = nodes
    .map((node) => scoreNode(node, queryTokens, relatedDistances))
    .filter((result) => {
      if (query.relatedTo && !query.text?.trim() && !relatedDistances.has(result.id)) {
        return false;
      }
      return result.score >= (query.minScore ?? 0);
    })
    .sort((left, right) =>
      right.score === left.score
        ? compareTimestampDescendingThenId(left, right)
        : right.score - left.score,
    );

  return results.slice(0, query.limit ?? 10);
}

export async function listGraphNeighbors(
  store: GraphReadableStore,
  nodeId: string,
  options?: {
    scopes?: HarnessGraphScope[];
    limit?: number;
  },
): Promise<HarnessGraphNodeRecord[]> {
  const outgoing = await readGraphEdges(store, {
    ...(options?.scopes?.length ? { scopes: options.scopes } : {}),
    fromIds: [nodeId],
  });
  const incoming = await readGraphEdges(store, {
    ...(options?.scopes?.length ? { scopes: options.scopes } : {}),
    toIds: [nodeId],
  });
  const neighborIds = new Set<string>();
  for (const edge of [...outgoing, ...incoming]) {
    if (edge.from !== nodeId) {
      neighborIds.add(edge.from);
    }
    if (edge.to !== nodeId) {
      neighborIds.add(edge.to);
    }
  }
  const nodes = await readGraphNodes(store, {
    ids: [...neighborIds],
    ...(options?.scopes?.length ? { scopes: options.scopes } : {}),
  });
  return nodes.slice(0, options?.limit ?? 10);
}

export async function collectGraphContextNodes(
  store: GraphReadableStore,
  query: GraphNodeQueryInput,
): Promise<HarnessGraphNodeRecord[]>;
export async function collectGraphContextNodes(input: {
  runtimeStore: GraphReadableStore;
  runId?: string;
  query: string;
  scopes?: HarnessGraphScope[];
  kinds?: HarnessGraphNodeKind[] | undefined;
  limit: number;
}): Promise<HarnessGraphNodeRecord[]>;
export async function collectGraphContextNodes(
  storeOrInput:
    | GraphReadableStore
    | {
        runtimeStore: GraphReadableStore;
        runId?: string;
        query: string;
        scopes?: HarnessGraphScope[];
        kinds?: HarnessGraphNodeKind[] | undefined;
        limit: number;
      },
  maybeQuery?: GraphNodeQueryInput,
): Promise<HarnessGraphNodeRecord[]> {
  if (maybeQuery) {
    const results = await queryHarnessGraph(
      storeOrInput as GraphReadableStore,
      normalizeGraphNodeQueryInput(maybeQuery),
    );
    return results.map(stripSearchFields);
  }

  const input = storeOrInput as {
    runtimeStore: GraphReadableStore;
    runId?: string;
    query: string;
    scopes?: HarnessGraphScope[];
    kinds?: HarnessGraphNodeKind[] | undefined;
    limit: number;
  };
  const results = await queryHarnessGraph(input.runtimeStore, {
    text: input.query,
    ...(input.runId ? { relatedTo: `run:${input.runId}` } : {}),
    ...(input.scopes?.length ? { scopes: input.scopes } : {}),
    ...(input.kinds?.length ? { kinds: input.kinds } : {}),
    limit: input.limit,
  });
  return results.map(stripSearchFields);
}

export function buildGraphContextBlocks(
  nodes: readonly HarnessGraphNodeRecord[],
): HarnessContextBlock[] {
  const block = buildGraphContextBlock(nodes);
  return block ? [block] : [];
}

function scoreNode(
  node: HarnessGraphNodeRecord,
  queryTokens: string[],
  relatedDistances: Map<string, number>,
): HarnessGraphSearchResult {
  const fieldTexts = {
    title: extractGraphSearchText(node.title),
    status: extractGraphSearchText(node.status),
    summary: extractGraphSearchText(node.summary),
    content: extractGraphSearchText(node.content),
    metadata: extractGraphSearchText(node.metadata),
  };

  const matchedFields = Object.entries(fieldTexts)
    .filter(([, text]) => scoreTokenOverlap(queryTokens, text) > 0)
    .map(([field]) => field);

  let score = 0;
  const reasons: string[] = [];

  const titleScore = scoreTokenOverlap(queryTokens, fieldTexts.title);
  if (titleScore > 0) {
    score += titleScore * 4;
    reasons.push(`title overlap ${titleScore.toFixed(3)}`);
  }

  const summaryScore = scoreTokenOverlap(queryTokens, fieldTexts.summary);
  if (summaryScore > 0) {
    score += summaryScore * 3;
    reasons.push(`summary overlap ${summaryScore.toFixed(3)}`);
  }

  const contentScore = scoreTokenOverlap(queryTokens, fieldTexts.content);
  if (contentScore > 0) {
    score += contentScore * 2;
    reasons.push(`content overlap ${contentScore.toFixed(3)}`);
  }

  const statusScore = scoreTokenOverlap(queryTokens, fieldTexts.status);
  if (statusScore > 0) {
    score += statusScore;
    reasons.push(`status overlap ${statusScore.toFixed(3)}`);
  }

  const metadataScore = scoreTokenOverlap(queryTokens, fieldTexts.metadata);
  if (metadataScore > 0) {
    score += metadataScore * 0.5;
    reasons.push(`metadata overlap ${metadataScore.toFixed(3)}`);
  }

  if (queryTokens.length === 0) {
    score += recencyScore(node.updatedAt);
    reasons.push("recency fallback");
  } else {
    score += recencyScore(node.updatedAt) * 0.6;
    reasons.push("recency boost");
  }

  const proximity = relatedDistances.get(node.id);
  if (proximity !== undefined) {
    const bonus = proximity === 0 ? 3 : proximity === 1 ? 2 : 1;
    score += bonus;
    reasons.push(`related distance ${proximity}`);
  }

  return {
    ...node,
    score,
    matchedFields,
    reasons,
  };
}

function buildAdjacency(
  edges: Array<{ from: string; to: string }>,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    addNeighbor(adjacency, edge.from, edge.to);
    addNeighbor(adjacency, edge.to, edge.from);
  }
  return adjacency;
}

function buildRelatedDistances(
  nodeId: string,
  adjacency: Map<string, Set<string>>,
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: Array<{ id: string; distance: number }> = [{ id: nodeId, distance: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (distances.has(current.id)) {
      continue;
    }
    distances.set(current.id, current.distance);
    if (current.distance >= 2) {
      continue;
    }
    for (const next of adjacency.get(current.id) ?? []) {
      if (!distances.has(next)) {
        queue.push({ id: next, distance: current.distance + 1 });
      }
    }
  }
  return distances;
}

async function readGraphNodes(
  store: GraphReadableStore,
  query: GraphNodeQueryInput,
): Promise<HarnessGraphNodeRecord[]> {
  if (store.listNodes) {
    return store.listNodes(normalizeGraphNodeQueryInput(query));
  }
  if (store.listGraphNodes) {
    return store.listGraphNodes(normalizeGraphNodeQueryInput(query));
  }
  throw new Error("Graph store does not support node reads");
}

async function readGraphEdges(
  store: GraphReadableStore,
  query: HarnessGraphEdgeQuery,
): Promise<Array<{ from: string; to: string; id?: string }>> {
  if (store.listEdges) {
    return store.listEdges(query);
  }
  if (store.listGraphEdges) {
    return store.listGraphEdges(query);
  }
  throw new Error("Graph store does not support edge reads");
}

function addNeighbor(
  adjacency: Map<string, Set<string>>,
  from: string,
  to: string,
): void {
  const neighbors = adjacency.get(from) ?? new Set<string>();
  neighbors.add(to);
  adjacency.set(from, neighbors);
}

function stripSearchFields(result: HarnessGraphSearchResult): HarnessGraphNodeRecord {
  const { score: _score, matchedFields: _matchedFields, reasons: _reasons, ...node } = result;
  return node;
}

function normalizeGraphNodeQueryInput(query: GraphNodeQueryInput): HarnessGraphNodeQuery {
  return {
    ...(query.scopes?.length ? { scopes: query.scopes } : {}),
    ...(query.kinds?.length ? { kinds: query.kinds } : {}),
    ...(query.ids?.length ? { ids: query.ids } : {}),
    ...(query.runId ? { runId: query.runId } : {}),
    ...(query.text ? { text: query.text } : {}),
    ...(query.relatedTo ? { relatedTo: query.relatedTo } : {}),
    ...(query.limit != null ? { limit: query.limit } : {}),
    ...(query.minScore != null ? { minScore: query.minScore } : {}),
  };
}
