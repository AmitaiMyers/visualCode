import type { CallRef, CodeEdge, CodeGraph, CodeNode, CodeSymbol, EdgeKind, ParsedFile } from "../model/types";
import { ROOT_ID, fileId, folderId, symbolId } from "../model/ids";
import { mustGet } from "../util/assert";
import { basename, dirname } from "../util/paths";
import { PythonModuleIndex, resolveTsImport } from "./resolveModules";

/** Where a local name in a file comes from: a target file and the name exported there. */
interface ImportedName {
  targetPath: string;
  imported: string; // "*" for the whole module, "default", or an exported name
}

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
  const symbolsById = new Map<string, CodeSymbol>();
  parsedFiles.forEach((parsed) => parsed.symbols.forEach((symbol) => symbolsById.set(symbol.id, symbol)));
  const resolver = new ImportResolver(parsedFiles);

  for (const parsed of parsedFiles) {
    const names = resolver.importedNames(parsed);
    for (const targetPath of resolver.importedFiles(parsed)) {
      edges.add(fileId(parsed.path), fileId(targetPath), "import", null);
    }
    for (const call of parsed.calls) {
      const target = resolveCall(parsed.path, call, names, symbolsById);
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

class ImportResolver {
  private readonly filePaths: Set<string>;
  private readonly pythonIndex: PythonModuleIndex;

  constructor(parsedFiles: ParsedFile[]) {
    this.filePaths = new Set(parsedFiles.map((parsed) => parsed.path));
    this.pythonIndex = new PythonModuleIndex(this.filePaths);
  }

  private resolveModule(parsed: ParsedFile, specifier: string): string | null {
    return parsed.language === "ts"
      ? resolveTsImport(parsed.path, specifier, this.filePaths)
      : this.pythonIndex.resolve(parsed.path, specifier);
  }

  /** Project files imported by this file (packages and unresolvable imports are skipped). */
  importedFiles(parsed: ParsedFile): string[] {
    const targets = new Set<string>();
    for (const ref of parsed.imports) {
      const moduleTarget = this.resolveModule(parsed, ref.specifier);
      if (moduleTarget !== null) targets.add(moduleTarget);
      for (const binding of ref.bindings) {
        const submodule = this.pythonSubmodule(parsed, ref.specifier, binding.imported);
        if (submodule !== null) targets.add(submodule);
      }
    }
    targets.delete(parsed.path);
    return [...targets];
  }

  /** For "from pkg import mod", the file of pkg.mod when that is a module rather than a name. */
  private pythonSubmodule(parsed: ParsedFile, specifier: string, imported: string): string | null {
    if (parsed.language !== "py" || imported === "*") return null;
    const separator = specifier.endsWith(".") ? "" : ".";
    return this.resolveModule(parsed, `${specifier}${separator}${imported}`);
  }

  /** Maps each local name bound by an import to the file and name it refers to. */
  importedNames(parsed: ParsedFile): Map<string, ImportedName> {
    const names = new Map<string, ImportedName>();
    for (const ref of parsed.imports) {
      for (const binding of ref.bindings) {
        const submodule = this.pythonSubmodule(parsed, ref.specifier, binding.imported);
        if (submodule !== null) {
          names.set(binding.local, { targetPath: submodule, imported: "*" });
          continue;
        }
        const moduleTarget = this.resolveModule(parsed, ref.specifier);
        if (moduleTarget !== null) {
          names.set(binding.local, { targetPath: moduleTarget, imported: binding.imported });
        }
      }
    }
    return names;
  }
}

/** Resolves a call site to a symbol id or file id, or null when it points outside the project. */
function resolveCall(
  filePath: string,
  call: CallRef,
  names: Map<string, ImportedName>,
  symbolsById: Map<string, CodeSymbol>,
): string | null {
  const localSymbol = (path: string, qualifiedName: string): string | null =>
    symbolsById.has(symbolId(path, qualifiedName)) ? symbolId(path, qualifiedName) : null;

  if (call.qualifier === null) {
    const local = localSymbol(filePath, call.name);
    if (local !== null) return local;
    const imported = names.get(call.name);
    return imported === undefined ? null : resolveImportedName(imported, call.name, localSymbol);
  }

  if (call.qualifier === "this") {
    const owningClass = owningClassOf(call.fromId, symbolsById);
    return owningClass === null ? null : localSymbol(filePath, `${owningClass.qualifiedName}.${call.name}`);
  }

  const imported = names.get(call.qualifier);
  if (imported !== undefined) {
    if (imported.imported === "*") {
      return localSymbol(imported.targetPath, call.name) ?? fileId(imported.targetPath);
    }
    // e.g. imported class Foo, then Foo.create()
    return (
      localSymbol(imported.targetPath, `${imported.imported}.${call.name}`) ??
      resolveImportedName(imported, call.qualifier, localSymbol)
    );
  }
  return localSymbol(filePath, `${call.qualifier}.${call.name}`);
}

function resolveImportedName(
  imported: ImportedName,
  localName: string,
  localSymbol: (path: string, qualifiedName: string) => string | null,
): string {
  if (imported.imported === "*") return fileId(imported.targetPath);
  // Default imports usually share the name of the default-exported declaration.
  const exportedName = imported.imported === "default" ? localName : imported.imported;
  return (
    localSymbol(imported.targetPath, exportedName) ??
    localSymbol(imported.targetPath, "default") ??
    fileId(imported.targetPath)
  );
}

function owningClassOf(fromId: string, symbolsById: Map<string, CodeSymbol>): CodeSymbol | null {
  const symbol = symbolsById.get(fromId);
  if (symbol === undefined) return null; // module-level code has no "this" class
  if (symbol.kind === "class") return symbol;
  return symbol.parentSymbolId === null ? null : mustGet(symbolsById, symbol.parentSymbolId, "Owning class");
}
