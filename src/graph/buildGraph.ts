import type { CodeEdge, CodeGraph, CodeNode, EdgeKind, ParsedFile } from "../model/types";
import { ROOT_ID, fileId, folderId } from "../model/ids";
import { mustGet } from "../util/assert";
import { basename, dirname } from "../util/paths";
import { CallResolver } from "./callResolution";
import { ImportResolver } from "./importResolution";

/** Builds the folder > file > symbol hierarchy plus import and call edges. */
export function buildGraph(rootLabel: string, parsedFiles: ParsedFile[]): CodeGraph {
  const nodes = new Map<string, CodeNode>();
  nodes.set(ROOT_ID, makeNode(ROOT_ID, "folder", rootLabel, "", null));

  for (const parsed of parsedFiles) {
    const parentId = ensureFolder(nodes, dirname(parsed.path));
    addChild(nodes, parentId, { ...makeNode(fileId(parsed.path), "file", basename(parsed.path), parsed.path, parentId), language: parsed.language });
    for (const symbol of parsed.symbols) {
      const symbolParentId = symbol.parentSymbolId === null ? fileId(parsed.path) : symbol.parentSymbolId;
      addChild(nodes, symbolParentId, {
        ...makeNode(symbol.id, "symbol", symbol.name, parsed.path, symbolParentId),
        symbol,
        language: parsed.language,
      });
    }
  }

  const edges = new EdgeSet();
  const imports = new ImportResolver(parsedFiles);
  const calls = new CallResolver(parsedFiles);

  for (const parsed of parsedFiles) {
    const names = imports.importedNames(parsed);
    for (const targetPath of imports.importedFiles(parsed)) {
      edges.add(fileId(parsed.path), fileId(targetPath), "import", null);
    }
    for (const call of parsed.calls) {
      const target = calls.resolve(parsed, call, names);
      if (target !== null && target !== call.fromId) {
        edges.add(call.fromId, target, "call", call.line);
      }
    }
  }

  return { rootId: ROOT_ID, nodes, edges: edges.list() };
}

function makeNode(id: string, kind: CodeNode["kind"], label: string, path: string, parentId: string | null): CodeNode {
  return { id, kind, label, path, parentId, childIds: [], symbol: null, language: null };
}

function addChild(nodes: Map<string, CodeNode>, parentId: string, child: CodeNode): void {
  if (nodes.has(child.id)) {
    throw new Error(`Duplicate graph node: ${child.id}`);
  }
  nodes.set(child.id, child);
  mustGet(nodes, parentId, "Parent node").childIds.push(child.id);
}

/** Creates folder nodes for every segment of folderPath and returns the deepest folder id. */
function ensureFolder(nodes: Map<string, CodeNode>, folderPath: string): string {
  if (folderPath === "") return ROOT_ID;
  const id = folderId(folderPath);
  if (!nodes.has(id)) {
    const parentId = ensureFolder(nodes, dirname(folderPath));
    addChild(nodes, parentId, makeNode(id, "folder", basename(folderPath), folderPath, parentId));
  }
  return id;
}

class EdgeSet {
  private readonly byKey = new Map<string, CodeEdge>();

  add(source: string, target: string, kind: EdgeKind, line: number | null): void {
    const key = `${source}|${target}|${kind}|${line}`;
    if (!this.byKey.has(key)) this.byKey.set(key, { source, target, kind, line });
  }

  list(): CodeEdge[] {
    return [...this.byKey.values()];
  }
}
