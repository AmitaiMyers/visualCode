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
  const touched = [...diff.addedLines, ...diff.removalAnchors];
  const visit = (nodeId: string): void => {
    const node = mustGet(graph.nodes, nodeId, "Symbol node");
    const symbol = node.symbol;
    if (symbol !== null) {
      const status = symbolStatus(diff.status, symbol.startLine, symbol.endLine, added, touched);
      if (status !== null) result.set(nodeId, status);
    }
    node.childIds.forEach(visit);
  };
  mustGet(graph.nodes, fileNodeId, "File node").childIds.forEach(visit);
  return result;
}

function symbolStatus(
  fileStatus: ChangeStatus,
  startLine: number,
  endLine: number,
  addedLines: Set<number>,
  touchedLines: number[],
): ChangeStatus | null {
  if (fileStatus === "added") return "added";
  const isTouched = touchedLines.some((line) => line >= startLine && line <= endLine);
  if (!isTouched) return null;
  for (let line = startLine; line <= endLine; line += 1) {
    if (!addedLines.has(line)) return "modified";
  }
  return "added"; // every line of the symbol is new
}
