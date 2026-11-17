import type { ChangeStatus, CodeGraph, FileDiff } from "../model/types";
import { fileId } from "../model/ids";
import { mustGet } from "../util/assert";

export interface ChangeInfo {
  status: ChangeStatus | null; // the node's own status; null when only descendants changed
  changedDescendants: number; // folders: changed files; files/classes: changed symbols
}

export type ChangeIndex = Map<string, ChangeInfo>;

/** Maps a diff onto graph nodes: files get their diff status, symbols whose lines changed get marked. */
export function buildChangeIndex(graph: CodeGraph, diffs: FileDiff[]): ChangeIndex {
  const index: ChangeIndex = new Map();
  const infoFor = (id: string): ChangeInfo => {
    const existing = index.get(id);
    if (existing) return existing;
    const created: ChangeInfo = { status: null, changedDescendants: 0 };
    index.set(id, created);
    return created;
  };

  for (const diff of diffs) {
    const fileNode = mustGet(graph.nodes, fileId(diff.path), "Changed file node");
    infoFor(fileNode.id).status = diff.status;
    forEachAncestor(graph, fileNode.id, (ancestorId) => {
      infoFor(ancestorId).changedDescendants += 1;
    });
    for (const [symbolNodeId, status] of changedSymbols(graph, fileNode.id, diff)) {
      infoFor(symbolNodeId).status = status;
      // Count up to and including the file, so folder counts stay "changed files".
      forEachAncestor(graph, symbolNodeId, (ancestorId) => {
        infoFor(ancestorId).changedDescendants += 1;
        return ancestorId !== fileNode.id;
      });
    }
  }
  return index;
}

/** Calls visit for each ancestor, nearest first. Stops early when visit returns false. */
function forEachAncestor(graph: CodeGraph, nodeId: string, visit: (ancestorId: string) => boolean | void): void {
  let current = mustGet(graph.nodes, nodeId, "Graph node").parentId;
  while (current !== null) {
    if (visit(current) === false) return;
    current = mustGet(graph.nodes, current, "Graph node").parentId;
  }
}

function changedSymbols(graph: CodeGraph, fileNodeId: string, diff: FileDiff): Map<string, ChangeStatus> {
  const result = new Map<string, ChangeStatus>();
  const added = new Set(diff.addedLines);
  const touched = new Set([...diff.addedLines, ...diff.removalAnchors]);
  const visit = (nodeId: string): void => {
    const node = mustGet(graph.nodes, nodeId, "Symbol node");
    if (node.symbol !== null) {
      // Removed blocks only exist in the old version: they are deleted by definition.
      const status = node.symbol.origin === "removed" ? "deleted" : symbolStatus(diff.status, ownLines(graph, nodeId), added, touched);
      if (status !== null) result.set(nodeId, status);
    }
    node.childIds.forEach(visit);
  };
  mustGet(graph.nodes, fileNodeId, "File node").childIds.forEach(visit);
  return result;
}

/** Lines that belong to a symbol itself: its range minus the ranges of nested symbols (a class's methods). */
function ownLines(graph: CodeGraph, nodeId: string): number[] {
  const node = mustGet(graph.nodes, nodeId, "Symbol node");
  const symbol = node.symbol;
  if (symbol === null) throw new Error(`Not a symbol: ${nodeId}`);
  const childRanges = node.childIds
    .map((childId) => {
      const child = mustGet(graph.nodes, childId, "Nested symbol").symbol;
      if (child === null) throw new Error(`Nested node is not a symbol: ${childId}`);
      return child;
    })
    .filter((child) => child.origin === "current"); // removed children's lines belong to the old version
  const lines: number[] = [];
  for (let line = symbol.startLine; line <= symbol.endLine; line += 1) {
    if (!childRanges.some((child) => line >= child.startLine && line <= child.endLine)) lines.push(line);
  }
  return lines;
}

function symbolStatus(fileStatus: ChangeStatus, lines: number[], addedLines: Set<number>, touchedLines: Set<number>): ChangeStatus | null {
  if (fileStatus === "added") return "added";
  if (!lines.some((line) => touchedLines.has(line))) return null;
  return lines.every((line) => addedLines.has(line)) ? "added" : "modified"; // every own line new = added
}
