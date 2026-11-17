import type { CodeSymbol, LineRange, RemovedLine } from "../model/types";
import type { Analysis } from "./analyze";
import { mustGet } from "../util/assert";

const splitCache = new WeakMap<Analysis, Map<string, string[]>>();

/** Lines of a file in its current version ("current") or its old version ("removed"), split once per analysis. */
export function fileLines(analysis: Analysis, path: string, origin: CodeSymbol["origin"]): string[] {
  let byKey = splitCache.get(analysis);
  if (byKey === undefined) {
    byKey = new Map();
    splitCache.set(analysis, byKey);
  }
  const key = `${origin}|${path}`;
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  const source = origin === "removed" ? analysis.baseContents : analysis.contents;
  const lines = mustGet(source, path, origin === "removed" ? "Old file content" : "File content").split("\n");
  byKey.set(key, lines);
  return lines;
}

/** The source lines of one block, from whichever version of the file it lives in. */
export function symbolLines(analysis: Analysis, symbol: CodeSymbol): string[] {
  return fileLines(analysis, symbol.filePath, symbol.origin).slice(symbol.startLine - 1, symbol.endLine);
}

const removedRangesCache = new WeakMap<Analysis, Map<string, LineRange[]>>();

/** Old-version line ranges of the blocks a diff deleted, per file. Those lines get their own ghost cards. */
function removedBlockRanges(analysis: Analysis, path: string): LineRange[] {
  let byPath = removedRangesCache.get(analysis);
  if (byPath === undefined) {
    byPath = new Map();
    for (const node of analysis.graph.nodes.values()) {
      if (node.symbol === null || node.symbol.origin !== "removed") continue;
      const ranges = byPath.get(node.symbol.filePath) ?? [];
      ranges.push({ startLine: node.symbol.startLine, endLine: node.symbol.endLine });
      byPath.set(node.symbol.filePath, ranges);
    }
    removedRangesCache.set(analysis, byPath);
  }
  return byPath.get(path) ?? [];
}

const NO_REMOVED_LINES: RemovedLine[] = [];

/**
 * The removed lines to show above each line of a file's current version: everything the diff removed there,
 * except lines of whole deleted blocks, which are shown as their own cards instead.
 */
export function removedLinesAbove(analysis: Analysis, path: string): (line: number) => RemovedLine[] {
  const diff = analysis.diffByPath.get(path);
  if (diff === undefined) return () => NO_REMOVED_LINES;
  const ranges = removedBlockRanges(analysis, path);
  const inRemovedBlock = (oldLine: number): boolean => ranges.some((range) => oldLine >= range.startLine && oldLine <= range.endLine);
  return (line) => (diff.removedBefore[line] ?? NO_REMOVED_LINES).filter((removed) => !inRemovedBlock(removed.oldLine));
}

/** How many lines a change touched in a block: added plus removed lines (a deleted block: all its lines). */
export function changeSize(analysis: Analysis, symbol: CodeSymbol): number {
  if (symbol.origin === "removed") return symbol.endLine - symbol.startLine + 1;
  const diff = analysis.diffByPath.get(symbol.filePath);
  if (diff === undefined) return 0;
  const inBlock = (line: number): boolean => line >= symbol.startLine && line <= symbol.endLine;
  const removed = Object.entries(diff.removedBefore).reduce((total, [line, lines]) => total + (inBlock(Number(line)) ? lines.length : 0), 0);
  return diff.addedLines.filter(inBlock).length + removed;
}
