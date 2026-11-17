import type { ChangeStatus, CodeGraph, SymbolKind } from "../model/types";
import type { ChangeIndex } from "./changes";
import { buildStory } from "./story";
import { mustGet } from "../util/assert";

export interface ReviewItem {
  nodeId: string;
  filePath: string;
  name: string; // what the reviewer sees: qualified or section name for blocks, file name for files without blocks
  kind: SymbolKind | "file";
  status: ChangeStatus;
}

/**
 * Everything a reviewer has to look at, in the order they would read it: files by path, and inside
 * each file the changed blocks in storyline order. A changed file with no changed block (e.g. a
 * deleted file) is listed as the file itself.
 */
export function reviewOrder(graph: CodeGraph, changes: ChangeIndex): ReviewItem[] {
  const changedFiles = [...changes.entries()]
    .filter(([id, info]) => info.status !== null && mustGet(graph.nodes, id, "Changed node").kind === "file")
    .map(([id]) => mustGet(graph.nodes, id, "Changed file"))
    .sort((a, b) => a.path.localeCompare(b.path));

  const items: ReviewItem[] = [];
  for (const file of changedFiles) {
    const story = buildStory(graph, file.path, new Set());
    const changedBlocks = story.entries.flatMap(({ item }) => {
      if (item.type !== "block") return [];
      const change = changes.get(item.nodeId);
      return change === undefined || change.status === null
        ? []
        : [
            {
              nodeId: item.nodeId,
              filePath: file.path,
              name: item.symbol.kind === "section" ? item.symbol.name : item.symbol.qualifiedName,
              kind: item.symbol.kind,
              status: change.status,
            },
          ];
    });
    if (changedBlocks.length > 0) {
      items.push(...changedBlocks);
    } else {
      const status = mustGet(changes, file.id, "File change").status;
      if (status === null) throw new Error(`Changed file without status: ${file.path}`);
      items.push({ nodeId: file.id, filePath: file.path, name: file.label, kind: "file", status });
    }
  }
  return items;
}
