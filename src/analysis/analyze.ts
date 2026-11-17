import type { CodeGraph, FileDiff, ParsedFile, Project, SourceFile } from "../model/types";
import { buildGraph } from "../graph/buildGraph";
import { buildChangeIndex, type ChangeIndex } from "../graph/changes";
import { contentOfAddedFile, contentOfDeletedFile, reconstructBase } from "../diff/unifiedDiff";
import { symbolId } from "../model/ids";
import { LANGUAGES, languageOf, type Language } from "../parse/language";
import { parsePythonFile } from "../parse/pythonParser";
import { addSections } from "../parse/sections";
import { parseTypeScriptFile } from "../parse/typescriptParser";
import { extractWithTreeSitter } from "../parse/treesitter/extract";
import { loadTreeSitterParsers, type GrammarSource, type TreeSitterParsers } from "../parse/treesitter/engine";
import { LANGUAGE_SPECS } from "../parse/treesitter/specs";
import { basename } from "../util/paths";

export interface Analysis {
  project: Project;
  graph: CodeGraph;
  contents: Map<string, string>; // file path -> source (absent for deleted files)
  baseContents: Map<string, string>; // changed file path -> its old version, for removed blocks and before/after views
  changes: ChangeIndex;
  diffByPath: Map<string, FileDiff>;
  skippedDiffPaths: string[]; // changed files VisualCode does not show (data, docs, binaries)
}

type TypeScriptModule = typeof import("typescript");

/** The parsers a project needs; each is loaded only when the project contains its language. */
export interface Parsers {
  typescript: TypeScriptModule | null;
  treeSitter: TreeSitterParsers;
}

/** Every language present in the project's files and diff. */
export function languagesIn(project: Project): Set<Language> {
  const paths = [...project.files.map((file) => file.path), ...project.diff.map((diff) => diff.path)];
  return new Set(paths.map(languageOf).filter((language): language is Language => language !== null));
}

/** Loads the parsers the project needs, then analyses it. */
export async function loadParsers(project: Project, grammars: GrammarSource): Promise<Parsers> {
  const languages = languagesIn(project);
  // The TypeScript compiler and the Tree-sitter grammars are large, so each loads only when used.
  const [typescript, treeSitter] = await Promise.all([
    languages.has("ts") ? import("typescript").then((module) => module.default) : Promise.resolve(null),
    loadTreeSitterParsers(languages, grammars),
  ]);
  return { typescript, treeSitter };
}

export async function analyzeProject(project: Project): Promise<Analysis> {
  const { BROWSER_GRAMMARS } = await import("../parse/treesitter/browserGrammars");
  return analyzeWith(await loadParsers(project, BROWSER_GRAMMARS), project);
}

/** Parses every file, merges in diff-only files, and builds the graph and change index. */
export function analyzeWith(parsers: Parsers, project: Project): Analysis {
  const reviewableDiffs = project.diff.filter((diff) => languageOf(diff.path) !== null);
  const skippedDiffPaths = project.diff.filter((diff) => languageOf(diff.path) === null).map((diff) => diff.path);

  const contents = new Map(project.files.map((file) => [file.path, file.content]));
  for (const diff of reviewableDiffs) {
    if (diff.status === "added" && !contents.has(diff.path)) {
      contents.set(diff.path, contentOfAddedFile(diff)); // diff-only input: rebuild new files from "+" lines
    }
  }

  const baseContents = rebuildBaseContents(reviewableDiffs, contents);
  const parsedFiles: ParsedFile[] = [...contents].map(([path, content]) => parseFile(parsers, { path, content }));
  for (const diff of reviewableDiffs) {
    if (!contents.has(diff.path)) {
      parsedFiles.push(emptyParsedFile(diff.path)); // deleted, or changed but not loaded
    }
  }
  const withRemoved = parsedFiles.map((parsed) => {
    const base = baseContents.get(parsed.path);
    return base === undefined ? parsed : withRemovedBlocks(parsed, parseFile(parsers, { path: parsed.path, content: base }));
  });
  withRemoved.sort((a, b) => a.path.localeCompare(b.path));

  const graph = buildGraph(project.title, withRemoved);
  return {
    project,
    graph,
    contents,
    baseContents,
    changes: buildChangeIndex(graph, reviewableDiffs),
    diffByPath: new Map(reviewableDiffs.map((diff) => [diff.path, diff])),
    skippedDiffPaths,
  };
}

/**
 * The old version of every changed file: deleted files from their patch, modified and renamed files by
 * applying the patch in reverse. Files whose patch does not match the loaded code are left out.
 */
function rebuildBaseContents(diffs: FileDiff[], contents: Map<string, string>): Map<string, string> {
  const base = new Map<string, string>();
  for (const diff of diffs) {
    if (diff.status === "deleted") {
      base.set(diff.path, contentOfDeletedFile(diff));
      continue;
    }
    const current = contents.get(diff.path);
    if (diff.status === "added" || diff.patch === "" || current === undefined) continue;
    const rebuilt = reconstructBase(current, diff.patch);
    if (rebuilt !== null) base.set(diff.path, rebuilt);
  }
  return base;
}

/**
 * Adds the blocks that existed in the old version but not in the new one, so deleted functions stay
 * visible in a review. Their line numbers refer to the old version (see Analysis.baseContents).
 */
function withRemovedBlocks(parsed: ParsedFile, base: ParsedFile): ParsedFile {
  const current = new Set(parsed.symbols.map((symbol) => symbol.id));
  const removed = base.symbols
    .filter((symbol) => symbol.kind !== "section" && !current.has(symbol.id))
    .map((symbol) => ({ ...symbol, origin: "removed" as const }));
  return removed.length === 0 ? parsed : { ...parsed, symbols: [...parsed.symbols, ...removed] };
}

function requireLanguage(path: string): Language {
  const language = languageOf(path);
  if (language === null) throw new Error(`Unsupported file reached the parser: ${path}`);
  return language;
}

function parseFile(parsers: Parsers, file: SourceFile): ParsedFile {
  const language = requireLanguage(file.path);
  switch (language) {
    case "plain":
      return wholeFileBlock(file);
    case "ts": {
      if (parsers.typescript === null) throw new Error("The TypeScript parser was not loaded");
      return addSections(parseTypeScriptFile(parsers.typescript, file), file.content);
    }
    case "py":
      return addSections(parsePythonFile(file), file.content);
    default: {
      const parser = parsers.treeSitter.get(language);
      const spec = LANGUAGE_SPECS[language];
      if (parser === undefined || spec === undefined) throw new Error(`No ${LANGUAGES[language].label} parser was loaded for ${file.path}`);
      return addSections(extractWithTreeSitter(parser, spec, file), file.content);
    }
  }
}

/** Files in languages VisualCode does not parse are shown as one block, so changes in them are never hidden. */
function wholeFileBlock(file: SourceFile): ParsedFile {
  const lineCount = file.content.split("\n").length;
  const name = basename(file.path);
  return {
    path: file.path,
    language: "plain",
    symbols: [
      {
        id: symbolId(file.path, "§file"),
        name,
        qualifiedName: "§file",
        kind: "section",
        filePath: file.path,
        parentSymbolId: null,
        startLine: 1,
        endLine: Math.max(1, lineCount),
        origin: "current",
      },
    ],
    imports: [],
    calls: [],
    containerRanges: [],
  };
}

function emptyParsedFile(path: string): ParsedFile {
  return { path, language: requireLanguage(path), symbols: [], imports: [], calls: [], containerRanges: [] };
}
