import type { CodeGraph, CodeNode, EdgeKind } from "../model/types";
import { at, mustGet } from "../util/assert";

export interface ViewNode {
  node: CodeNode;
  ghost: boolean; // lives outside the current scope; shown only because an edge reaches it
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  kinds: EdgeKind[];
  count: number; // number of underlying leaf edges merged into this one
}

export interface GraphView {
  scopeId: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
}

/** Root-to-node chain of ids, e.g. [root, folder, file, symbol]. */
export function ancestry(graph: CodeGraph, nodeId: string): string[] {
  const chain: string[] = [];
  let current: string | null = nodeId;
  while (current !== null) {
    chain.push(current);
    current = mustGet(graph.nodes, current, "Graph node").parentId;
  }
  return chain.reverse();
}

/**
 * The node that stands for nodeId when looking at scope:
 * - inside the scope: the scope's child that contains it;
 * - outside: the child of the deepest common ancestor that contains it (a "ghost").
 * Returns null when nodeId is the scope itself or one of its ancestors.
 */
export function representative(graph: CodeGraph, scopeChain: string[], nodeId: string): ViewNode | null {
  const nodeChain = ancestry(graph, nodeId);
  let shared = 0;
  while (shared < scopeChain.length && shared < nodeChain.length && scopeChain[shared] === nodeChain[shared]) {
    shared += 1;
  }
  if (shared === nodeChain.length) return null; // node is the scope or an ancestor of it
  const id = at(nodeChain, shared, "ancestry");
  return { node: mustGet(graph.nodes, id, "Graph node"), ghost: shared < scopeChain.length };
}

/**
 * Builds what the canvas shows for one scope: the scope's children plus ghost nodes outside it,
 * with every leaf edge lifted to the visible nodes that contain its endpoints.
 */
export function computeView(graph: CodeGraph, scopeId: string, includeNode: (nodeId: string) => boolean): GraphView {
  const scope = mustGet(graph.nodes, scopeId, "Scope node");
  const scopeChain = ancestry(graph, scopeId);
  const inScope = new Map<string, ViewNode>();
  for (const childId of scope.childIds) {
    if (includeNode(childId)) {
      inScope.set(childId, { node: mustGet(graph.nodes, childId, "Graph node"), ghost: false });
    }
  }

  const ghosts = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();
  for (const edge of graph.edges) {
    const source = representative(graph, scopeChain, edge.source);
    const target = representative(graph, scopeChain, edge.target);
    if (source === null || target === null || source.node.id === target.node.id) continue;
    if (source.ghost && target.ghost) continue;
    if (!isVisible(source, inScope) || !isVisible(target, inScope)) continue;
    for (const end of [source, target]) {
      if (end.ghost) ghosts.set(end.node.id, end);
    }
    const id = `${source.node.id}->${target.node.id}`;
    const existing = edges.get(id);
    if (existing) {
      existing.count += 1;
      if (!existing.kinds.includes(edge.kind)) existing.kinds.push(edge.kind);
    } else {
      edges.set(id, { id, source: source.node.id, target: target.node.id, kinds: [edge.kind], count: 1 });
    }
  }
  return { scopeId, nodes: [...inScope.values(), ...ghosts.values()], edges: [...edges.values()] };
}

function isVisible(end: ViewNode, inScope: Map<string, ViewNode>): boolean {
  return end.ghost || inScope.has(end.node.id);
}

/** Initial scope: skip down through folders that contain nothing but a single sub-folder. */
export function initialScope(graph: CodeGraph): string {
  let current = mustGet(graph.nodes, graph.rootId, "Root node");
  while (current.childIds.length === 1) {
    const only = mustGet(graph.nodes, at(current.childIds, 0, "children"), "Graph node");
    if (only.kind !== "folder") break;
    current = only;
  }
  return current.id;
}

/** Counts items attached to nodes (e.g. comments) onto every ancestor, so collapsed nodes show totals. */
export function rollUpCounts(graph: CodeGraph, nodeIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const nodeId of nodeIds) {
    if (!graph.nodes.has(nodeId)) continue; // e.g. a comment on code that is no longer loaded
    for (const id of ancestry(graph, nodeId)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
