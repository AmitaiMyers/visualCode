import type { CodeGraph, FileDiff, ParsedFile, Project, SourceFile } from "../model/types";
import { buildGraph } from "../graph/buildGraph";
import { buildChangeIndex, type ChangeIndex } from "../graph/changes";
import { contentOfAddedFile } from "../diff/unifiedDiff";
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

  const parsedFiles: ParsedFile[] = [...contents].map(([path, content]) => parseFile(parsers, { path, content }));
  for (const diff of reviewableDiffs) {
    if (!contents.has(diff.path)) {
      parsedFiles.push(emptyParsedFile(diff.path)); // deleted, or changed but not loaded
    }
  }
  parsedFiles.sort((a, b) => a.path.localeCompare(b.path));

  const graph = buildGraph(project.title, parsedFiles);
  return {
    project,
    graph,
    contents,
    changes: buildChangeIndex(graph, reviewableDiffs),
    diffByPath: new Map(reviewableDiffs.map((diff) => [diff.path, diff])),
    skippedDiffPaths,
  };
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
