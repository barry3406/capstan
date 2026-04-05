import type { HarnessContextBlock } from "../types.js";
import type {
  HarnessGraphNodeKind,
  HarnessGraphNodeRecord,
} from "./types.js";
import { scoreGraphNode, sortGraphNodes } from "./utils.js";

export function selectGraphNodesForContext(
  nodes: readonly HarnessGraphNodeRecord[],
  input: {
    query: string;
    limit: number;
    kinds?: HarnessGraphNodeKind[] | undefined;
  },
): HarnessGraphNodeRecord[] {
  const filtered = input.kinds?.length
    ? nodes.filter((node) => input.kinds!.includes(node.kind))
    : nodes.slice();
  if (filtered.length === 0) {
    return [];
  }

  if (!input.query.trim()) {
    return sortGraphNodes(filtered).slice(0, input.limit);
  }

  return filtered
    .map((node) => ({
      node,
      score: scoreGraphNode(node, input.query),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score === left.score
        ? right.node.updatedAt.localeCompare(left.node.updatedAt)
        : right.score - left.score,
    )
    .slice(0, input.limit)
    .map(({ node }) => node);
}

export function buildGraphContextBlock(
  nodes: readonly HarnessGraphNodeRecord[],
): HarnessContextBlock | undefined {
  if (nodes.length === 0) {
    return undefined;
  }

  const content = sortGraphNodes(nodes)
    .reverse()
    .map((node) => `- [${node.kind}] ${renderGraphNodeLine(node)}`)
    .join("\n");

  return {
    kind: "graph",
    title: "Graph State",
    content,
    tokens: estimateTokens(content),
  };
}

export function buildGraphContextBlocks(
  nodes: readonly HarnessGraphNodeRecord[],
): HarnessContextBlock[] {
  const block = buildGraphContextBlock(nodes);
  return block ? [block] : [];
}

function renderGraphNodeLine(node: HarnessGraphNodeRecord): string {
  const parts = [node.title];
  if (node.status) {
    parts.push(`status=${node.status}`);
  }
  if (typeof node.order === "number") {
    parts.push(`order=${node.order}`);
  }
  if (node.summary) {
    parts.push(`summary=${node.summary}`);
  }
  return parts.join(" ");
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
