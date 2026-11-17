import type * as TS from "typescript";
import type { CallRef, CodeSymbol, ImportRef, ParsedFile, SourceFile, SymbolKind } from "../model/types";
import { fileId, symbolId } from "../model/ids";

type TypeScriptModule = typeof TS;

/** Collects symbols, imports and calls from one JS/TS file using the TypeScript compiler's parser. */
export function parseTypeScriptFile(ts: TypeScriptModule, file: SourceFile): ParsedFile {
  const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKindFor(ts, file.path));
  const collector = new Collector(ts, sourceFile, file.path);
  collector.collect();
  return {
    path: file.path,
    language: "ts",
    symbols: collector.symbols,
    imports: collector.imports,
    calls: collector.calls,
    containerRanges: [],
  };
}

function scriptKindFor(ts: TypeScriptModule, path: string): TS.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

class Collector {
  readonly symbols: CodeSymbol[] = [];
  readonly imports: ImportRef[] = [];
  readonly calls: CallRef[] = [];
  private readonly symbolsById = new Map<string, CodeSymbol>();
  private readonly symbolIdByNode = new Map<TS.Node, string>();

  constructor(
    private readonly ts: TypeScriptModule,
    private readonly sourceFile: TS.SourceFile,
    private readonly path: string,
  ) {}

  collect(): void {
    for (const statement of this.sourceFile.statements) {
      this.collectTopLevel(statement);
    }
    this.walk(this.sourceFile, fileId(this.path));
  }

  // ----- declarations -----

  private collectTopLevel(statement: TS.Statement): void {
    const ts = this.ts;
    if (ts.isImportDeclaration(statement)) {
      this.collectImportDeclaration(statement);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      this.imports.push({ specifier: statement.moduleSpecifier.text, bindings: [] });
    } else if (ts.isFunctionDeclaration(statement) && statement.body) {
      this.addSymbol(statement.name ? statement.name.text : "default", "function", statement, null);
    } else if (ts.isClassDeclaration(statement)) {
      this.collectClass(statement.name ? statement.name.text : "default", statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        this.collectVariable(declaration);
      }
    }
  }

  private collectImportDeclaration(declaration: TS.ImportDeclaration): void {
    const ts = this.ts;
    if (!ts.isStringLiteral(declaration.moduleSpecifier)) return;
    const ref: ImportRef = { specifier: declaration.moduleSpecifier.text, bindings: [] };
    const clause = declaration.importClause;
    if (clause) {
      if (clause.name) {
        ref.bindings.push({ local: clause.name.text, imported: "default" });
      }
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        ref.bindings.push({ local: named.name.text, imported: "*" });
      } else if (named) {
        for (const element of named.elements) {
          const imported = element.propertyName ? element.propertyName.getText(this.sourceFile) : element.name.text;
          ref.bindings.push({ local: element.name.text, imported });
        }
      }
    }
    this.imports.push(ref);
  }

  private collectVariable(declaration: TS.VariableDeclaration): void {
    const ts = this.ts;
    const init = declaration.initializer;
    if (!ts.isIdentifier(declaration.name) || !init) return;
    const name = declaration.name.text;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      this.addSymbol(name, "function", declaration, null);
    } else if (ts.isClassExpression(init)) {
      this.collectClass(name, init);
    } else if (isRequireCall(ts, init)) {
      // const x = require("./x")
      this.imports.push({ specifier: requireSpecifier(init), bindings: [{ local: name, imported: "*" }] });
    }
  }

  private collectClass(name: string, declaration: TS.ClassLikeDeclaration): void {
    const ts = this.ts;
    const classSymbol = this.addSymbol(name, "class", declaration, null);
    for (const member of declaration.members) {
      if ((ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) && member.body) {
        this.addSymbol(member.name.getText(this.sourceFile), "method", member, classSymbol);
      } else if (ts.isConstructorDeclaration(member) && member.body) {
        this.addSymbol("constructor", "method", member, classSymbol);
      } else if (
        ts.isPropertyDeclaration(member) &&
        member.initializer &&
        (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
      ) {
        this.addSymbol(member.name.getText(this.sourceFile), "method", member, classSymbol);
      }
    }
  }

  private addSymbol(name: string, kind: SymbolKind, node: TS.Node, parent: CodeSymbol | null): CodeSymbol {
    const qualifiedName = parent ? `${parent.qualifiedName}.${name}` : name;
    const id = symbolId(this.path, qualifiedName);
    const startLine = this.lineOf(node.getStart(this.sourceFile, true)); // include JSDoc
    const endLine = this.lineOf(node.getEnd());
    this.symbolIdByNode.set(node, id);
    const existing = this.symbolsById.get(id);
    if (existing) {
      // Redeclaration (e.g. accessor pair): treat it as one symbol spanning both.
      existing.startLine = Math.min(existing.startLine, startLine);
      existing.endLine = Math.max(existing.endLine, endLine);
      return existing;
    }
    const symbol: CodeSymbol = {
      id,
      name,
      qualifiedName,
      kind,
      filePath: this.path,
      parentSymbolId: parent ? parent.id : null,
      startLine,
      endLine,
      origin: "current",
    };
    this.symbolsById.set(id, symbol);
    this.symbols.push(symbol);
    return symbol;
  }

  private lineOf(position: number): number {
    return this.sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  }

  // ----- calls -----

  /** Walks the AST, attributing each call to the innermost known symbol around it. */
  private walk(node: TS.Node, enclosingId: string): void {
    const ownId = this.symbolIdForNode(node);
    const currentId = ownId === null ? enclosingId : ownId;
    this.recordCall(node, currentId);
    node.forEachChild((child) => this.walk(child, currentId));
  }

  private symbolIdForNode(node: TS.Node): string | null {
    const id = this.symbolIdByNode.get(node);
    return id === undefined ? null : id;
  }

  private recordCall(node: TS.Node, fromId: string): void {
    const ts = this.ts;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        this.recordDynamicImport(node);
        return;
      }
      this.recordCallee(node.expression, fromId);
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      // <Component /> is a use of Component, the React equivalent of a call.
      // Lowercase tags (<div>) are built-in HTML elements, not project code.
      const isIntrinsic = ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text);
      if (!isIntrinsic) this.recordCallee(node.tagName, fromId);
    }
  }

  private recordDynamicImport(node: TS.CallExpression): void {
    const [argument] = node.arguments;
    if (argument && this.ts.isStringLiteral(argument)) {
      this.imports.push({ specifier: argument.text, bindings: [] });
    }
  }

  private recordCallee(expression: TS.Node, fromId: string): void {
    const ts = this.ts;
    const line = this.lineOf(expression.getStart(this.sourceFile));
    if (ts.isIdentifier(expression)) {
      this.calls.push({ fromId, qualifier: null, name: expression.text, line });
    } else if (ts.isPropertyAccessExpression(expression)) {
      const object = expression.expression;
      const name = expression.name.text;
      if (object.kind === ts.SyntaxKind.ThisKeyword) {
        this.calls.push({ fromId, qualifier: "this", name, line });
      } else if (ts.isIdentifier(object)) {
        this.calls.push({ fromId, qualifier: object.text, name, line });
      }
    }
  }
}

function isRequireCall(ts: TypeScriptModule, node: TS.Expression): node is TS.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0] as TS.Expression)
  );
}

function requireSpecifier(node: TS.CallExpression): string {
  return (node.arguments[0] as TS.StringLiteral).text;
}
