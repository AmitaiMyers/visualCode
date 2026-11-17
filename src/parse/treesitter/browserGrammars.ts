// Asset URLs for the Tree-sitter runtime and grammars. Vite copies each .wasm into the build; the browser
// fetches a grammar only when a loaded project contains that language (and caches it for offline use).
import runtime from "web-tree-sitter/tree-sitter.wasm?url";
import c from "tree-sitter-wasms/out/tree-sitter-c.wasm?url";
import cSharp from "tree-sitter-wasms/out/tree-sitter-c_sharp.wasm?url";
import cpp from "tree-sitter-wasms/out/tree-sitter-cpp.wasm?url";
import go from "tree-sitter-wasms/out/tree-sitter-go.wasm?url";
import java from "tree-sitter-wasms/out/tree-sitter-java.wasm?url";
import kotlin from "tree-sitter-wasms/out/tree-sitter-kotlin.wasm?url";
import php from "tree-sitter-wasms/out/tree-sitter-php.wasm?url";
import ruby from "tree-sitter-wasms/out/tree-sitter-ruby.wasm?url";
import rust from "tree-sitter-wasms/out/tree-sitter-rust.wasm?url";
import swift from "tree-sitter-wasms/out/tree-sitter-swift.wasm?url";
import type { GrammarSource } from "./engine";
import { mustGet } from "../../util/assert";

const GRAMMAR_URLS = new Map<string, string>([
  ["c", c],
  ["c_sharp", cSharp],
  ["cpp", cpp],
  ["go", go],
  ["java", java],
  ["kotlin", kotlin],
  ["php", php],
  ["ruby", ruby],
  ["rust", rust],
  ["swift", swift],
]);

export const BROWSER_GRAMMARS: GrammarSource = {
  runtime,
  grammar: (name) => mustGet(GRAMMAR_URLS, name, "Tree-sitter grammar"),
};
