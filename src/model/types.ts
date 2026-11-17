// Core data model shared by ingestion, parsing, graph building and the UI.

export type Language = "ts" | "py";

export interface SourceFile {
  path: string; // POSIX path relative to the project root, no leading slash
  content: string;
}

/** "section" = a run of module-level code between declarations (imports, setup, main guard). */
export type SymbolKind = "class" | "function" | "method" | "section";

export interface CodeSymbol {
  id: string; // "sym:<path>#<qualifiedName>"
  name: string;
  qualifiedName: string; // "fn", "Class", or "Class.method"
  kind: SymbolKind;
  filePath: string;
  parentSymbolId: string | null; // owning class for methods
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive
}

/** One name bound by an import. imported is "*" for namespace/module imports, "default" for default imports. */
export interface ImportBinding {
  local: string;
  imported: string;
}

export interface ImportRef {
  specifier: string; // module specifier exactly as written ("./util", "..pkg.mod", "react")
  bindings: ImportBinding[];
}

/** A call site: qualifier is null for bare calls, "this" for this./self. calls, otherwise the object name. */
export interface CallRef {
  fromId: string; // enclosing symbol id, or the file node id for module-level code
  qualifier: string | null;
  name: string;
  line: number; // 1-based line of the call site
}

export interface ParsedFile {
  path: string;
  language: Language;
  symbols: CodeSymbol[];
  imports: ImportRef[];
  calls: CallRef[];
}

// ---------- Diff ----------

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileDiff {
  path: string; // new path (old path for deleted files)
  oldPath: string | null; // set for renames
  status: ChangeStatus;
  addedLines: number[]; // line numbers in the new file
  removalAnchors: number[]; // new-file line numbers right after which lines were removed
  addedCount: number;
  removedCount: number;
  patch: string; // raw hunk text, for display
}

// ---------- Graph ----------

export type NodeKind = "folder" | "file" | "symbol";

export interface CodeNode {
  id: string;
  kind: NodeKind;
  label: string;
  path: string; // folder or file path ("" for the root)
  parentId: string | null;
  childIds: string[];
  symbol: CodeSymbol | null;
  language: Language | null;
}

export type EdgeKind = "import" | "call";

export interface CodeEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  line: number | null; // call-site line for call edges, null for imports
}

export interface CodeGraph {
  rootId: string;
  nodes: Map<string, CodeNode>;
  edges: CodeEdge[];
}

export interface Project {
  id: string; // stable key used to store review comments
  title: string;
  files: SourceFile[];
  diff: FileDiff[];
}

// ---------- Review ----------

export type CommentSource = "human" | "ai";

export interface ReviewComment {
  id: string;
  nodeId: string;
  body: string;
  source: CommentSource;
  resolved: boolean;
  createdAt: string; // ISO timestamp
}
