import { basename } from "../util/paths";

/**
 * Every language VisualCode reads.
 * - "ts" and "py" use their dedicated parsers (TypeScript compiler API, line-based Python).
 * - Languages with a `grammar` are parsed with Tree-sitter.
 * - "plain" files are any other code: shown as one whole-file block, never parsed.
 */
export type Language = "ts" | "py" | "java" | "kotlin" | "go" | "csharp" | "rust" | "c" | "cpp" | "php" | "ruby" | "swift" | "plain";

export interface LanguageInfo {
  id: Language;
  label: string;
  extensions: readonly string[];
  /** Tree-sitter grammar name in tree-sitter-wasms (tree-sitter-<grammar>.wasm), or null. */
  grammar: string | null;
  lineComment: string | null;
  keywords: ReadonlySet<string>;
  /** A bare call inside a class can mean one of its own methods (Java, C#, Kotlin, Swift, C++, Ruby). */
  implicitThis: boolean;
  /**
   * Code can use names from other files without a file-level import (packages, namespaces, modules,
   * C linkage), so unresolved calls fall back to a unique match in the same folder, then the project.
   */
  nameFallback: boolean;
}

function words(list: string): ReadonlySet<string> {
  return new Set(list.split(/\s+/).filter((word) => word !== ""));
}

const C_KEYWORDS = "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL true false";

export const LANGUAGES: Record<Language, LanguageInfo> = {
  ts: {
    id: "ts", implicitThis: false, nameFallback: false,
    label: "JavaScript / TypeScript",
    extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    grammar: null,
    lineComment: "//",
    keywords: words(
      "abstract as async await break case catch class const continue default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield",
    ),
  },
  py: {
    id: "py", implicitThis: false, nameFallback: false,
    label: "Python",
    extensions: ["py"],
    grammar: null,
    lineComment: "#",
    keywords: words("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield"),
  },
  java: {
    id: "java", implicitThis: true, nameFallback: true,
    label: "Java",
    extensions: ["java"],
    grammar: "java",
    lineComment: "//",
    keywords: words(
      "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws try true false var void volatile while record",
    ),
  },
  kotlin: {
    id: "kotlin", implicitThis: true, nameFallback: true,
    label: "Kotlin",
    extensions: ["kt", "kts"],
    grammar: "kotlin",
    lineComment: "//",
    keywords: words(
      "as break class companion continue data do else enum false for fun if import in interface internal is null object open override package private protected public return sealed super this throw true try typealias val var when while suspend",
    ),
  },
  go: {
    id: "go", implicitThis: false, nameFallback: true,
    label: "Go",
    extensions: ["go"],
    grammar: "go",
    lineComment: "//",
    keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false"),
  },
  csharp: {
    id: "csharp", implicitThis: true, nameFallback: true,
    label: "C#",
    extensions: ["cs"],
    grammar: "c_sharp",
    lineComment: "//",
    keywords: words(
      "abstract as async await base bool break case catch class const continue decimal default delegate do double else enum event false finally float for foreach get if in int interface internal is lock long namespace new null object out override private protected public readonly record ref return sealed set static string struct switch this throw true try typeof using var virtual void while",
    ),
  },
  rust: {
    id: "rust", implicitThis: false, nameFallback: true,
    label: "Rust",
    extensions: ["rs"],
    grammar: "rust",
    lineComment: "//",
    keywords: words(
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    ),
  },
  c: { id: "c", implicitThis: false, nameFallback: true, label: "C", extensions: ["c"], grammar: "c", lineComment: "//", keywords: words(C_KEYWORDS) },
  cpp: {
    id: "cpp", implicitThis: true, nameFallback: true,
    label: "C++",
    extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx", "h"],
    grammar: "cpp",
    lineComment: "//",
    keywords: words(
      `${C_KEYWORDS} bool catch class constexpr delete explicit friend mutable namespace new noexcept nullptr operator override private protected public template this throw try typename using virtual`,
    ),
  },
  php: {
    id: "php", implicitThis: false, nameFallback: true,
    label: "PHP",
    extensions: ["php"],
    grammar: "php",
    lineComment: "//",
    keywords: words(
      "abstract array as break case catch class const continue default do echo else elseif extends false final finally fn for foreach function global if implements include interface namespace new null private protected public require require_once return static switch throw trait true try use var while",
    ),
  },
  ruby: {
    id: "ruby", implicitThis: true, nameFallback: true,
    label: "Ruby",
    extensions: ["rb", "rake"],
    grammar: "ruby",
    lineComment: "#",
    keywords: words("alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_reader attr_accessor private"),
  },
  swift: {
    id: "swift", implicitThis: true, nameFallback: true,
    label: "Swift",
    extensions: ["swift"],
    grammar: "swift",
    lineComment: "//",
    keywords: words(
      "as associatedtype break case catch class continue default defer do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public return self Self static struct subscript super switch throw throws true try typealias var where while",
    ),
  },
  plain: {
    id: "plain", implicitThis: false, nameFallback: false,
    label: "Other code",
    // Code and config people review, shown as whole-file blocks. Data and lock files are left out on purpose.
    extensions: [
      "sh", "bash", "zsh", "ps1", "sql", "scala", "sc", "dart", "lua", "r", "ex", "exs", "erl", "hs", "ml", "clj", "vue", "svelte",
      "html", "css", "scss", "sass", "less", "yaml", "yml", "toml", "gradle", "groovy", "pl", "m", "mm", "fs", "vb", "zig", "nim", "jl", "tf", "proto",
    ],
    grammar: null,
    lineComment: null,
    keywords: new Set(),
  },
};

const LANGUAGE_BY_EXTENSION = new Map<string, Language>(
  Object.values(LANGUAGES).flatMap((info) => info.extensions.map((extension) => [extension, info.id] as const)),
);

/** Folders that never hold reviewable project source. */
const IGNORED_FOLDERS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", "__pycache__", ".venv", "venv", ".next", ".tox",
  ".mypy_cache", ".pytest_cache", "target", "vendor", "bin", "obj", ".gradle", ".idea", "Pods", "DerivedData",
]);

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES = 2000;

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Manifests and deployment files, loaded as plain files by name: they tell VisualCode which apps a
 * project has, what they depend on and how they connect (see system/detect). Lock files stay out.
 */
const PLAIN_FILE_NAMES = new Set([
  "package.json", "composer.json", "requirements.txt", "go.mod", "pom.xml", "Gemfile", "Dockerfile", "Procfile", ".env.example", ".env.sample",
]);

export function languageOf(path: string): Language | null {
  if (PLAIN_FILE_NAMES.has(basename(path))) return "plain";
  const language = LANGUAGE_BY_EXTENSION.get(extensionOf(path));
  return language === undefined ? null : language;
}

/** True for languages whose blocks, calls and imports are read (everything except "plain"). */
export function isParsedLanguage(language: Language): boolean {
  return language !== "plain";
}

function isGeneratedOrMinified(path: string): boolean {
  return /\.min\.[cm]?js$/i.test(path) || path.endsWith(".d.ts") || /\.(pb|generated|g)\.\w+$/i.test(path);
}

/** True when a path should be loaded: a known language, outside dependency and build folders. */
export function isSupportedSourcePath(path: string): boolean {
  if (languageOf(path) === null || isGeneratedOrMinified(path)) return false;
  return path.split("/").every((segment) => !IGNORED_FOLDERS.has(segment));
}

/** Human list for UI copy: "JavaScript / TypeScript, Python, Java, … and Swift". */
export const PARSED_LANGUAGE_LIST: string = (() => {
  const labels = Object.values(LANGUAGES)
    .filter((info) => isParsedLanguage(info.id))
    .map((info) => info.label);
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1] ?? ""}`;
})();
