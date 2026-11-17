import type { CallRef, CodeSymbol, ParsedFile } from "../model/types";
import { fileId, symbolId } from "../model/ids";
import { LANGUAGES } from "../parse/language";
import { mustGet } from "../util/assert";
import { dirname } from "../util/paths";
import type { ImportedName } from "./importResolution";

/**
 * Resolves a call site to the block (or file) it reaches. Order:
 * 1. the caller's own class for this/self calls (and bare calls in languages with implicit this);
 * 2. a definition in the same file;
 * 3. an imported name;
 * 4. for languages without file-level imports: a unique name in the same folder, then in the project.
 * Returns null when the call leaves the project (libraries) or stays ambiguous.
 */
export class CallResolver {
  private readonly symbolsById: Map<string, CodeSymbol>;
  private readonly topLevelByName = new Map<string, string[]>(); // "lang|name" -> ids
  private readonly topLevelByDirName = new Map<string, string[]>(); // "lang|dir|name" -> ids

  constructor(parsedFiles: ParsedFile[]) {
    this.symbolsById = new Map();
    for (const parsed of parsedFiles) {
      for (const symbol of parsed.symbols) {
        this.symbolsById.set(symbol.id, symbol);
        if (symbol.parentSymbolId !== null || symbol.kind === "section") continue;
        push(this.topLevelByName, `${parsed.language}|${symbol.qualifiedName}`, symbol.id);
        push(this.topLevelByDirName, `${parsed.language}|${dirname(parsed.path)}|${symbol.qualifiedName}`, symbol.id);
      }
    }
  }

  resolve(parsed: ParsedFile, call: CallRef, names: Map<string, ImportedName>): string | null {
    const info = LANGUAGES[parsed.language];
    const owner = this.ownerPrefixOf(call.fromId);

    if (call.qualifier === "this") {
      return owner === null ? null : this.symbolIn(parsed.path, `${owner}.${call.name}`);
    }

    if (call.qualifier === null) {
      if (info.implicitThis && owner !== null) {
        const member = this.symbolIn(parsed.path, `${owner}.${call.name}`);
        if (member !== null) return member;
      }
      const local = this.symbolIn(parsed.path, call.name);
      if (local !== null) return local;
      const imported = names.get(call.name);
      if (imported !== undefined) return this.resolveImportedName(imported, call.name);
      return info.nameFallback ? this.byName(parsed, call.name) : null;
    }

    const imported = names.get(call.qualifier);
    if (imported !== undefined) {
      if (imported.imported === "*") {
        return this.firstIn(imported.targetPaths, call.name) ?? fileId(firstOf(imported.targetPaths));
      }
      // e.g. imported class Foo, then Foo.create()
      return this.firstIn(imported.targetPaths, `${imported.imported}.${call.name}`) ?? this.resolveImportedName(imported, call.qualifier);
    }
    const sameFileMember = this.symbolIn(parsed.path, `${call.qualifier}.${call.name}`);
    if (sameFileMember !== null || !info.nameFallback) return sameFileMember;

    // Qualifier is a type found by name (Store.open(), Strings::trim) or a namespace (util::trim).
    const type = this.byName(parsed, call.qualifier);
    if (type !== null) {
      const typeSymbol = mustGet(this.symbolsById, type, "Type symbol");
      return this.symbolIn(typeSymbol.filePath, `${typeSymbol.qualifiedName}.${call.name}`) ?? type;
    }
    return /^[a-z_]/.test(call.qualifier) ? this.byName(parsed, call.name) : null;
  }

  /** A unique top-level definition of `name`: first in the caller's folder (same package), then anywhere. */
  private byName(parsed: ParsedFile, name: string): string | null {
    const sameFolder = (this.topLevelByDirName.get(`${parsed.language}|${dirname(parsed.path)}|${name}`) ?? []).filter((id) => this.fileOf(id) !== parsed.path);
    if (sameFolder.length === 1) return firstOf(sameFolder);
    const anywhere = (this.topLevelByName.get(`${parsed.language}|${name}`) ?? []).filter((id) => this.fileOf(id) !== parsed.path);
    return anywhere.length === 1 ? firstOf(anywhere) : null; // ambiguous names are left unlinked rather than guessed
  }

  private resolveImportedName(imported: ImportedName, localName: string): string {
    if (imported.imported === "*") return fileId(firstOf(imported.targetPaths));
    // Default imports usually share the name of the default-exported declaration.
    const exportedName = imported.imported === "default" ? localName : imported.imported;
    return this.firstIn(imported.targetPaths, exportedName) ?? this.firstIn(imported.targetPaths, "default") ?? fileId(firstOf(imported.targetPaths));
  }

  private firstIn(paths: string[], qualifiedName: string): string | null {
    for (const path of paths) {
      const found = this.symbolIn(path, qualifiedName);
      if (found !== null) return found;
    }
    return null;
  }

  private symbolIn(path: string, qualifiedName: string): string | null {
    const id = symbolId(path, qualifiedName);
    return this.symbolsById.has(id) ? id : null;
  }

  private fileOf(id: string): string {
    return mustGet(this.symbolsById, id, "Symbol").filePath;
  }

  /**
   * The qualified name "this" refers to inside the caller: its class, the class of its method, or the
   * type prefix of a method defined away from its type (C++ `Store::add` in store.cpp, Go receivers).
   */
  private ownerPrefixOf(fromId: string): string | null {
    const symbol = this.symbolsById.get(fromId);
    if (symbol === undefined) return null; // module-level code has no "this"
    if (symbol.kind === "class") return symbol.qualifiedName;
    if (symbol.parentSymbolId !== null) return mustGet(this.symbolsById, symbol.parentSymbolId, "Owning class").qualifiedName;
    const dot = symbol.qualifiedName.lastIndexOf(".");
    return dot === -1 ? null : symbol.qualifiedName.slice(0, dot);
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function firstOf(items: string[]): string {
  const [first] = items;
  if (first === undefined) throw new Error("Expected at least one import target");
  return first;
}
