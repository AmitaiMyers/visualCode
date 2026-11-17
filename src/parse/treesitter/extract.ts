import type { Node, Parser } from "web-tree-sitter";
import type { CallRef, CodeSymbol, ImportRef, LineRange, ParsedFile, SourceFile, SymbolKind } from "../../model/types";
import type { Language } from "../language";
import { fileId, symbolId } from "../../model/ids";
import { kids } from "./nodes";

/** A class-like declaration. Secondary ones (Rust `impl`, Swift `extension`, a reopened class) add members to the primary. */
export interface ContainerMatch {
  name: string;
  primary: boolean;
}

/** A function or method definition with a body. */
export interface FunctionMatch {
  name: string;
  /** Owning type for methods declared outside their type (Go receivers, C++ `Cart::add`). */
  receiver: string | null;
  /** Variable that means "this object" inside the function (Go receiver name). */
  selfName: string | null;
}

export interface CallMatch {
  qualifier: string | null; // object or type the call is made on; this/self keywords are normalised to "this"
  name: string;
}

/**
 * How to read one Tree-sitter grammar. Each function inspects a single node and returns null when the
 * node is not of that kind; the extractor walks the tree and decides nesting and ownership.
 */
export interface LanguageSpec {
  language: Language;
  container(node: Node): ContainerMatch | null;
  function(node: Node): FunctionMatch | null;
  call(node: Node): CallMatch | null;
  /** Import-like statements; null means "not an import node". */
  imports(node: Node): ImportRef[] | null;
  selfKeywords: ReadonlySet<string>;
}

interface WalkContext {
  classSymbol: CodeSymbol | null;
  ownerId: string; // calls inside are attributed here
  inFunction: boolean;
  inNestedContainer: boolean;
  selfName: string | null;
}

/** Parses one file with Tree-sitter and reads its blocks, imports and calls through the language spec. */
export function extractWithTreeSitter(parser: Parser, spec: LanguageSpec, file: SourceFile): ParsedFile {
  const tree = parser.parse(file.content);
  if (tree === null) throw new Error(`Tree-sitter could not parse ${file.path}`);
  const extractor = new Extractor(spec, file.path);
  extractor.run(tree.rootNode);
  tree.delete(); // WASM memory is not garbage collected
  return {
    path: file.path,
    language: spec.language,
    symbols: extractor.symbols,
    imports: extractor.imports,
    calls: extractor.calls,
    containerRanges: extractor.containerRanges,
  };
}

export function lineRange(node: Node): LineRange {
  const endRow = node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row ? node.endPosition.row - 1 : node.endPosition.row;
  return { startLine: node.startPosition.row + 1, endLine: endRow + 1 };
}

class Extractor {
  readonly symbols: CodeSymbol[] = [];
  readonly imports: ImportRef[] = [];
  readonly calls: CallRef[] = [];
  readonly containerRanges: LineRange[] = [];
  private readonly classes = new Map<string, CodeSymbol>();
  private readonly ids = new Set<string>();

  constructor(
    private readonly spec: LanguageSpec,
    private readonly path: string,
  ) {}

  run(root: Node): void {
    this.collectContainers(root);
    this.walk(root, { classSymbol: null, ownerId: fileId(this.path), inFunction: false, inNestedContainer: false, selfName: null });
  }

  /**
   * First pass: every top-level class-like declaration, grouped by name. The primary declaration (or the
   * first one) becomes the class block; the others only contribute members, and their own lines are
   * recorded as container ranges so they do not turn into module sections.
   */
  private collectContainers(root: Node): void {
    const groups = new Map<string, Node[]>();
    const primaries = new Map<string, Node>();
    const visit = (node: Node): void => {
      const container = this.spec.container(node);
      if (container !== null) {
        const group = groups.get(container.name);
        if (group) group.push(node);
        else groups.set(container.name, [node]);
        if (container.primary && !primaries.has(container.name)) primaries.set(container.name, node);
        return; // nested containers are not blocks
      }
      if (this.spec.function(node) !== null) return; // types declared inside functions are not blocks
      kids(node).forEach(visit);
    };
    visit(root);

    for (const [name, nodes] of groups) {
      const chosen = primaries.get(name) ?? nodes[0];
      if (chosen === undefined) continue;
      const range = lineRange(chosen);
      this.classes.set(name, this.addSymbol(name, name, "class", null, range));
      for (const other of nodes) {
        if (other !== chosen) this.containerRanges.push(lineRange(other));
      }
    }
  }

  private walk(node: Node, context: WalkContext): void {
    const imports = this.spec.imports(node);
    if (imports !== null) {
      this.imports.push(...imports);
      return;
    }

    const container = this.spec.container(node);
    if (container !== null) {
      const isTopLevel = context.classSymbol === null && !context.inFunction && !context.inNestedContainer;
      const classSymbol = isTopLevel ? this.classes.get(container.name) ?? null : null;
      const next: WalkContext =
        classSymbol === null
          ? { ...context, inNestedContainer: true }
          : { classSymbol, ownerId: classSymbol.id, inFunction: false, inNestedContainer: false, selfName: null };
      kids(node).forEach((child) => this.walk(child, next));
      return;
    }

    const fn = this.spec.function(node);
    if (fn !== null) {
      if (context.inFunction || context.inNestedContainer) {
        kids(node).forEach((child) => this.walk(child, context)); // nested function: part of its parent block
        return;
      }
      const symbol = this.addFunction(fn, context.classSymbol, lineRange(node));
      const next: WalkContext = { classSymbol: context.classSymbol, ownerId: symbol.id, inFunction: true, inNestedContainer: false, selfName: fn.selfName };
      kids(node).forEach((child) => this.walk(child, next));
      return;
    }

    const call = this.spec.call(node);
    if (call !== null) {
      const qualifier = call.qualifier !== null && (this.spec.selfKeywords.has(call.qualifier) || call.qualifier === context.selfName) ? "this" : call.qualifier;
      this.calls.push({ fromId: context.ownerId, qualifier, name: call.name, line: node.startPosition.row + 1 });
    }
    kids(node).forEach((child) => this.walk(child, context));
  }

  private addFunction(fn: FunctionMatch, classSymbol: CodeSymbol | null, range: LineRange): CodeSymbol {
    if (classSymbol !== null) {
      return this.addSymbol(fn.name, `${classSymbol.qualifiedName}.${fn.name}`, "method", classSymbol.id, range);
    }
    if (fn.receiver !== null) {
      const owner = this.classes.get(fn.receiver);
      if (owner !== undefined) return this.addSymbol(fn.name, `${owner.qualifiedName}.${fn.name}`, "method", owner.id, range);
      // The type lives in another file: keep the method as a top-level block named Type.method.
      return this.addSymbol(fn.name, `${fn.receiver}.${fn.name}`, "function", null, range);
    }
    return this.addSymbol(fn.name, fn.name, "function", null, range);
  }

  /** Overloads and redefinitions get "name(2)", "name(3)" so every block keeps its own id. */
  private addSymbol(name: string, qualifiedName: string, kind: SymbolKind, parentSymbolId: string | null, range: LineRange): CodeSymbol {
    let unique = qualifiedName;
    for (let n = 2; this.ids.has(symbolId(this.path, unique)); n += 1) unique = `${qualifiedName}(${n})`;
    const symbol: CodeSymbol = {
      id: symbolId(this.path, unique),
      name,
      qualifiedName: unique,
      kind,
      filePath: this.path,
      parentSymbolId,
      startLine: range.startLine,
      endLine: range.endLine,
    };
    this.ids.add(symbol.id);
    this.symbols.push(symbol);
    return symbol;
  }
}
