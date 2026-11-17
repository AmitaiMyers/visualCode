import type { Parser } from "web-tree-sitter";
import { LANGUAGES, type Language } from "../language";

/** Where the Tree-sitter runtime and grammar .wasm files live: asset URLs in the browser, file paths in tests. */
export interface GrammarSource {
  runtime: string;
  grammar(name: string): string;
}

export type TreeSitterParsers = ReadonlyMap<Language, Parser>;

let runtimeReady: Promise<typeof import("web-tree-sitter")> | null = null;
const parserCache = new Map<Language, Promise<Parser>>();

/** Loads the runtime once, then each requested grammar once; grammars are fetched only when a project uses them. */
export async function loadTreeSitterParsers(languages: Iterable<Language>, source: GrammarSource): Promise<TreeSitterParsers> {
  const wanted = [...new Set(languages)].filter((language) => LANGUAGES[language].grammar !== null);
  if (wanted.length === 0) return new Map();
  if (runtimeReady === null) {
    runtimeReady = import("web-tree-sitter").then(async (module) => {
      await module.Parser.init({ locateFile: () => source.runtime });
      return module;
    });
  }
  const module = await runtimeReady;
  const entries = await Promise.all(
    wanted.map(async (language) => {
      let pending = parserCache.get(language);
      if (pending === undefined) {
        pending = loadParser(module, language, source);
        parserCache.set(language, pending);
      }
      return [language, await pending] as const;
    }),
  );
  return new Map(entries);
}

async function loadParser(module: typeof import("web-tree-sitter"), language: Language, source: GrammarSource): Promise<Parser> {
  const grammar = LANGUAGES[language].grammar;
  if (grammar === null) throw new Error(`${language} has no Tree-sitter grammar`);
  const loaded = await module.Language.load(source.grammar(grammar));
  const parser = new module.Parser();
  parser.setLanguage(loaded);
  return parser;
}
