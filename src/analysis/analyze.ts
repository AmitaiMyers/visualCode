import type { CodeGraph, FileDiff, ParsedFile, Project } from "../model/types";
import { buildGraph } from "../graph/buildGraph";
import { buildChangeIndex, type ChangeIndex } from "../graph/changes";
import { contentOfAddedFile } from "../diff/unifiedDiff";
import { languageOf } from "../parse/language";
import { parsePythonFile } from "../parse/pythonParser";
import { addSections } from "../parse/sections";
import { parseTypeScriptFile } from "../parse/typescriptParser";

export interface Analysis {
  project: Project;
  graph: CodeGraph;
  contents: Map<string, string>; // file path -> source (absent for deleted files)
  changes: ChangeIndex;
  diffByPath: Map<string, FileDiff>;
  skippedDiffPaths: string[]; // changed files in a language the POC does not parse
}

type TypeScriptModule = typeof import("typescript");

/** Parses every file, merges in diff-only files, and builds the graph and change index. */
export async function analyzeProject(project: Project): Promise<Analysis> {
  // The TypeScript compiler is large, so it is loaded only when a project is analysed.
  const ts: TypeScriptModule = (await import("typescript")).default;
  return analyzeWithTypeScript(ts, project);
}

export function analyzeWithTypeScript(ts: TypeScriptModule, project: Project): Analysis {
  const reviewableDiffs = project.diff.filter((diff) => languageOf(diff.path) !== null);
  const skippedDiffPaths = project.diff.filter((diff) => languageOf(diff.path) === null).map((diff) => diff.path);

  const contents = new Map(project.files.map((file) => [file.path, file.content]));
  for (const diff of reviewableDiffs) {
    if (diff.status === "added" && !contents.has(diff.path)) {
      contents.set(diff.path, contentOfAddedFile(diff)); // diff-only input: rebuild new files from "+" lines
    }
  }

  const parsedFiles: ParsedFile[] = [...contents].map(([path, content]) => parseFile(ts, path, content));
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

function parseFile(ts: TypeScriptModule, path: string, content: string): ParsedFile {
  const language = languageOf(path);
  if (language === null) {
    throw new Error(`Unsupported file reached the parser: ${path}`);
  }
  const file = { path, content };
  const parsed = language === "ts" ? parseTypeScriptFile(ts, file) : parsePythonFile(file);
  return addSections(parsed, content);
}

function emptyParsedFile(path: string): ParsedFile {
  const language = languageOf(path);
  if (language === null) {
    throw new Error(`Unsupported file reached the parser: ${path}`);
  }
  return { path, language, symbols: [], imports: [], calls: [] };
}
