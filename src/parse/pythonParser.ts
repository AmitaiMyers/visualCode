import type { CallRef, CodeSymbol, ImportRef, ParsedFile, SourceFile, SymbolKind } from "../model/types";
import { fileId, symbolId } from "../model/ids";
import { at } from "../util/assert";

/**
 * Lightweight, line-based Python parser. It finds imports, top-level functions and classes,
 * methods directly inside top-level classes, and call sites. Nested functions/classes are not
 * separate symbols: their calls are attributed to the enclosing symbol.
 */
export function parsePythonFile(file: SourceFile): ParsedFile {
  const lines = blankStringsAndComments(file.content).split("\n");
  const parser = new PythonLineParser(file.path, lines);
  parser.parse();
  return {
    path: file.path,
    language: "py",
    symbols: parser.symbols,
    imports: parser.imports,
    calls: parser.calls,
    containerRanges: [],
  };
}

const NON_CALL_KEYWORDS = new Set([
  "if", "elif", "while", "for", "return", "and", "or", "not", "in", "is", "lambda",
  "assert", "with", "yield", "await", "del", "except", "raise", "def", "class",
  "import", "from", "print", "super", "match", "case",
]);

/** Matches a (possibly dotted) name followed by "(", not preceded by "." or a word char. */
const CALL_PATTERN = /(?<![\w.])([A-Za-z_][\w.]*)\s*\(/g;
const DEF_PATTERN = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/;
const CLASS_PATTERN = /^class\s+([A-Za-z_]\w*)/;
const IMPORT_PATTERN = /^import\s+(.+)$/;
const FROM_IMPORT_PATTERN = /^from\s+(\.*[\w.]*)\s+import\s+(.+)$/;

interface OpenBlock {
  indent: number;
  ownerId: string; // id that calls inside this block are attributed to
  symbol: CodeSymbol | null; // null for nested blocks that are not tracked as symbols
}

class PythonLineParser {
  readonly symbols: CodeSymbol[] = [];
  readonly imports: ImportRef[] = [];
  readonly calls: CallRef[] = [];
  private readonly stack: OpenBlock[] = [];
  private lastContentLine = 0;
  private parenDepth = 0;
  private decoratorStartLine: number | null = null; // first "@decorator" line above the next def/class

  constructor(
    private readonly path: string,
    private readonly lines: string[],
  ) {}

  parse(): void {
    let index = 0;
    while (index < this.lines.length) {
      index = this.parseLine(index);
    }
    this.closeBlocks(-1);
  }

  /** Parses the line at index and returns the index of the next line to parse. */
  private parseLine(index: number): number {
    const raw = at(this.lines, index, "python line");
    const lineNumber = index + 1;
    const text = raw.trim();
    const isContinuation = this.parenDepth > 0;
    this.parenDepth = Math.max(0, this.parenDepth + parenBalance(raw));
    if (text === "") return index + 1;

    if (!isContinuation) {
      this.closeBlocks(indentOf(raw));
    }
    const ownerId = this.currentOwnerId();

    const importEnd = this.parseImport(text, index);
    if (importEnd !== null) {
      this.lastContentLine = importEnd + 1;
      return importEnd + 1;
    }

    const header = isContinuation ? null : this.parseHeader(text, indentOf(raw), lineNumber);
    if (!isContinuation) this.trackDecorator(text, lineNumber);
    const callText = header === null ? text : text.slice(header);
    this.collectCalls(callText, ownerId, lineNumber);
    this.lastContentLine = lineNumber;
    return index + 1;
  }

  /** Remembers where a decorator stack starts so the decorated def/class includes it. */
  private trackDecorator(text: string, lineNumber: number): void {
    if (text.startsWith("@")) {
      if (this.decoratorStartLine === null) this.decoratorStartLine = lineNumber;
    } else {
      this.decoratorStartLine = null; // any other line (including the def it decorated) ends the stack
    }
  }

  private currentOwnerId(): string {
    const top = this.stack[this.stack.length - 1];
    return top === undefined ? fileId(this.path) : top.ownerId;
  }

  /** Closes every open block whose indentation is >= indent (-1 closes all). */
  private closeBlocks(indent: number): void {
    while (this.stack.length > 0) {
      const top = at(this.stack, this.stack.length - 1, "block stack");
      if (indent !== -1 && top.indent < indent) return;
      if (top.symbol) {
        top.symbol.endLine = Math.max(top.symbol.startLine, this.lastContentLine);
      }
      this.stack.pop();
    }
  }

  /** Handles "def"/"class" lines. Returns the offset where the call-scan should start, or null. */
  private parseHeader(text: string, indent: number, lineNumber: number): number | null {
    const defMatch = DEF_PATTERN.exec(text);
    const classMatch = defMatch ? null : CLASS_PATTERN.exec(text);
    const match = defMatch ?? classMatch;
    if (match === null) return null;
    const name = at(match, 1, "header name");
    const kind = this.symbolKindFor(defMatch !== null);
    const symbol = kind === null ? null : this.addSymbol(name, kind, lineNumber);
    this.stack.push({ indent, ownerId: symbol ? symbol.id : this.currentOwnerId(), symbol });
    return match[0].length;
  }

  /** Decides whether a def/class at the current nesting becomes a tracked symbol. */
  private symbolKindFor(isDef: boolean): SymbolKind | null {
    if (this.stack.length === 0) return isDef ? "function" : "class";
    const onlyBlock = this.stack.length === 1 ? at(this.stack, 0, "block stack") : null;
    if (isDef && onlyBlock && onlyBlock.symbol && onlyBlock.symbol.kind === "class") return "method";
    return null;
  }

  private addSymbol(name: string, kind: SymbolKind, lineNumber: number): CodeSymbol {
    const parent = kind === "method" ? at(this.stack, 0, "class block").symbol : null;
    const qualifiedName = parent ? `${parent.qualifiedName}.${name}` : name;
    const symbol: CodeSymbol = {
      id: symbolId(this.path, qualifiedName),
      name,
      qualifiedName,
      kind,
      filePath: this.path,
      parentSymbolId: parent ? parent.id : null,
      startLine: this.decoratorStartLine ?? lineNumber,
      endLine: lineNumber,
    };
    // A redefinition replaces the earlier one in Python; keep a single symbol per id.
    const existingIndex = this.symbols.findIndex((existing) => existing.id === symbol.id);
    if (existingIndex === -1) {
      this.symbols.push(symbol);
      return symbol;
    }
    return at(this.symbols, existingIndex, "symbol");
  }

  /** Parses an import statement starting at index. Returns the index of its last line, or null. */
  private parseImport(text: string, index: number): number | null {
    const fromMatch = FROM_IMPORT_PATTERN.exec(text);
    if (fromMatch) {
      const specifier = at(fromMatch, 1, "from-import module");
      const { names, lastIndex } = this.readImportedNames(at(fromMatch, 2, "from-import names"), index);
      const bindings = names
        .filter((name) => name !== "*")
        .map((name) => {
          const [imported, local] = splitAlias(name);
          return { local, imported };
        });
      this.imports.push({ specifier, bindings });
      return lastIndex;
    }
    const importMatch = IMPORT_PATTERN.exec(text);
    if (importMatch) {
      for (const part of splitNames(at(importMatch, 1, "import names"))) {
        const [module, local] = splitAlias(part);
        this.imports.push({ specifier: module, bindings: [{ local, imported: "*" }] });
      }
      return index;
    }
    return null;
  }

  /** Reads "a, b as c" or a parenthesised list that may span several lines. */
  private readImportedNames(firstLineNames: string, index: number): { names: string[]; lastIndex: number } {
    if (!firstLineNames.startsWith("(") || firstLineNames.includes(")")) {
      return { names: splitNames(firstLineNames.replace(/[()]/g, "")), lastIndex: index };
    }
    let collected = firstLineNames;
    let lastIndex = index;
    while (!collected.includes(")") && lastIndex + 1 < this.lines.length) {
      lastIndex += 1;
      collected += ` ${at(this.lines, lastIndex, "python line").trim()}`;
    }
    this.parenDepth = 0;
    return { names: splitNames(collected.replace(/[()]/g, "")), lastIndex };
  }

  private collectCalls(text: string, fromId: string, line: number): void {
    for (const match of text.matchAll(CALL_PATTERN)) {
      const dotted = at(match, 1, "call name");
      const parts = dotted.split(".");
      const name = at(parts, parts.length - 1, "call name part");
      if (parts.length === 1 && NON_CALL_KEYWORDS.has(name)) continue;
      const rawQualifier = parts.length === 1 ? null : parts.slice(0, -1).join(".");
      const qualifier = rawQualifier === "self" || rawQualifier === "cls" ? "this" : rawQualifier;
      this.calls.push({ fromId, qualifier, name, line });
    }
  }
}

function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function parenBalance(line: string): number {
  let balance = 0;
  for (const char of line) {
    if (char === "(" || char === "[" || char === "{") balance += 1;
    else if (char === ")" || char === "]" || char === "}") balance -= 1;
  }
  return balance;
}

function splitNames(list: string): string[] {
  return list
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** "a.b as c" -> ["a.b", "c"]; "a.b" -> ["a.b", "a.b"]. */
function splitAlias(part: string): [string, string] {
  const pieces = part.split(/\s+as\s+/);
  const original = at(pieces, 0, "import name").trim();
  const alias = pieces.length > 1 ? at(pieces, 1, "import alias").trim() : original;
  return [original, alias];
}

/**
 * Replaces the contents of string literals and comments with spaces, keeping quotes and
 * newlines, so later regexes never match code-like text inside strings or comments.
 */
export function blankStringsAndComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === "#") {
      while (i < source.length && source.charAt(i) !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      const triple = source.startsWith(char.repeat(3), i);
      const quote = triple ? char.repeat(3) : char;
      out += quote;
      i += quote.length;
      while (i < source.length && !source.startsWith(quote, i)) {
        const inner = source.charAt(i);
        if (!triple && inner === "\n") break; // unterminated single-line string
        if (inner === "\\" && i + 1 < source.length) {
          out += source.charAt(i + 1) === "\n" ? " \n" : "  ";
          i += 2;
          continue;
        }
        out += inner === "\n" ? "\n" : " ";
        i += 1;
      }
      if (source.startsWith(quote, i)) {
        out += quote;
        i += quote.length;
      }
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}
