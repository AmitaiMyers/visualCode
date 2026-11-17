import { analyzeWith, loadParsers, type Analysis } from "../analysis/analyze";
import type { FileDiff, SourceFile } from "../model/types";
import { LANGUAGES } from "../parse/language";
import type { GrammarSource } from "../parse/treesitter/engine";

/** Joins lines so fixtures read like real files (line numbers = array index + 1). */
export function lines(...source: string[]): string {
  return source.join("\n");
}

/** Tests load the same .wasm files the browser does, straight from node_modules. */
const fromRoot = (relative: string): string => new URL(`../../${relative}`, import.meta.url).pathname;
const NODE_GRAMMARS: GrammarSource = {
  runtime: fromRoot("node_modules/web-tree-sitter/tree-sitter.wasm"),
  grammar: (name) => fromRoot(`node_modules/tree-sitter-wasms/out/tree-sitter-${name}.wasm`),
};

// Load every parser once for the whole test run, so analyze() can stay synchronous.
const allLanguages = Object.values(LANGUAGES).flatMap((info) => info.extensions.slice(0, 1).map((extension) => ({ path: `x.${extension}`, content: "" })));
const parsers = await loadParsers({ id: "all", title: "all", files: allLanguages, diff: [] }, NODE_GRAMMARS);

export function analyze(files: SourceFile[], diff: FileDiff[] = []): Analysis {
  return analyzeWith(parsers, { id: "test", title: "test", files, diff });
}
