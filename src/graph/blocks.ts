import type { CodeGraph, CodeSymbol } from "../model/types";
import { fileId } from "../model/ids";
import { mustGet } from "../util/assert";

/** The innermost block of a file's current version that holds a line, or null (file not loaded, or no block there). */
export function blockAtLine(graph: CodeGraph, path: string, line: number): CodeSymbol | null {
  const file = graph.nodes.get(fileId(path));
  if (file === undefined) return null;
  let innermost: CodeSymbol | null = null;
  const pending = [...file.childIds];
  while (pending.length > 0) {
    const node = mustGet(graph.nodes, pending.pop() ?? "", "Symbol node");
    const symbol = node.symbol;
    if (symbol !== null && symbol.origin === "current" && line >= symbol.startLine && line <= symbol.endLine) {
      if (innermost === null || symbol.endLine - symbol.startLine < innermost.endLine - innermost.startLine) innermost = symbol;
    }
    pending.push(...node.childIds);
  }
  return innermost;
}

/** The functions, methods and classes of a file's current version (not its module-level sections), in line order. */
export function declaredBlocks(graph: CodeGraph, path: string): CodeSymbol[] {
  const file = graph.nodes.get(fileId(path));
  if (file === undefined) return [];
  const blocks: CodeSymbol[] = [];
  const pending = [...file.childIds];
  while (pending.length > 0) {
    const node = mustGet(graph.nodes, pending.pop() ?? "", "Symbol node");
    if (node.symbol !== null && node.symbol.origin === "current" && node.symbol.kind !== "section" && node.symbol.kind !== "class") blocks.push(node.symbol);
    pending.push(...node.childIds);
  }
  return blocks.sort((a, b) => a.startLine - b.startLine);
}
