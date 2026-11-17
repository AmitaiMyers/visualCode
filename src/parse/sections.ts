import type { CodeSymbol, Language, LineRange, ParsedFile } from "../model/types";
import { fileId, symbolId } from "../model/ids";
import { at, mustGet } from "../util/assert";

/** A contiguous run of non-blank module-level lines. */
interface Paragraph {
  startLine: number;
  endLine: number;
  lines: string[];
}

type SectionCategory = "imports" | "types" | "entry" | "setup";

const SECTION_TITLES: Record<SectionCategory, string> = {
  imports: "imports",
  types: "types",
  entry: "entry point",
  setup: "setup",
};

interface SectionRules {
  /** First line of an imports paragraph (imports, includes, package/namespace headers). */
  imports: RegExp;
  /** Lines that belong to the declaration directly below them: comments, decorators, attributes. */
  prelude: RegExp;
  /** A paragraph containing this line is the program's entry point. */
  entry: RegExp | null;
  /** First line of code of a type-only paragraph. */
  types: RegExp | null;
  /** Lines that only open or close a namespace/module around the real code; never a block on their own. */
  scaffolding: RegExp | null;
}

const C_STYLE_PRELUDE = /^(\/\/|\/\*|\*|@)/;

const RULES: Record<Exclude<Language, "plain">, SectionRules> = {
  ts: {
    imports: /^(import\s|export\s.*\sfrom\s|(const|let|var)\s+\w+\s*=\s*require\()/,
    prelude: C_STYLE_PRELUDE,
    entry: null,
    types: /^(export\s+)?(declare\s+)?(interface|type|enum|const\s+enum)\s/,
    scaffolding: null,
  },
  py: { imports: /^(import|from)\s/, prelude: /^(#|@)/, entry: /^if\s+__name__\s*==/, types: null, scaffolding: null },
  java: { imports: /^(import|package)\s/, prelude: C_STYLE_PRELUDE, entry: null, types: null, scaffolding: null },
  kotlin: { imports: /^(import|package)\s/, prelude: C_STYLE_PRELUDE, entry: null, types: /^(typealias)\s/, scaffolding: null },
  go: { imports: /^(package|import)\b/, prelude: /^(\/\/|\/\*|\*)/, entry: null, types: /^type\s/, scaffolding: null },
  csharp: { imports: /^(using|namespace)\b/, prelude: /^(\/\/|\/\*|\*|\[)/, entry: null, types: null, scaffolding: /^namespace\s+[\w.]+\s*[{;]?$/ },
  rust: { imports: /^(pub(\([^)]*\))?\s+)?(use|mod|extern\s+crate)\b/, prelude: /^(\/\/|\/\*|\*|#\[|#!\[)/, entry: null, types: /^(pub(\([^)]*\))?\s+)?type\s/, scaffolding: /^(pub\s+)?mod\s+\w+\s*\{$/ },
  c: { imports: /^#\s*(include|import|pragma)/, prelude: /^(\/\/|\/\*|\*)/, entry: null, types: /^typedef\s/, scaffolding: /^(extern\s+"C"\s*\{|#\s*(ifndef|ifdef|if|define|endif|else)\b.*)$/ },
  cpp: { imports: /^(#\s*(include|import|pragma)|using\s+namespace\b)/, prelude: /^(\/\/|\/\*|\*|template\s*<|\[\[)/, entry: null, types: /^(typedef|using\s+\w+\s*=)/, scaffolding: /^(namespace(\s+[\w:]+)?\s*\{|extern\s+"C"\s*\{|#\s*(ifndef|ifdef|if|define|endif|else)\b.*)$/ },
  php: { imports: /^(<\?php|namespace|use|require(_once)?|include(_once)?|declare)\b/, prelude: /^(\/\/|\/\*|\*|#\[)/, entry: null, types: null, scaffolding: null },
  ruby: { imports: /^(require|require_relative|load|autoload)\b/, prelude: /^#/, entry: /^if\s+__FILE__\s*==\s*\$0/, types: null, scaffolding: /^(module\s+[\w:]+|end)$/ },
  swift: { imports: /^(@testable\s+)?import\s/, prelude: /^(\/\/|\/\*|\*|@)/, entry: null, types: /^typealias\s/, scaffolding: null },
};

/** Closing braces, `end`, `};` and similar lines left over around declarations are not sections. */
const PUNCTUATION_ONLY = /^([{}()[\];,]|end)*$/;

function isScaffolding(line: string, rules: SectionRules): boolean {
  const code = line.replace(/\s*\/\/.*$/, "").trim(); // `}  // namespace shop` is still just a brace
  return PUNCTUATION_ONLY.test(code.replace(/\s+/g, "")) || (rules.scaffolding !== null && rules.scaffolding.test(code));
}

/** Net open brackets in a paragraph: above zero means the next paragraph continues it (e.g. Go `import (` … `)`). */
function openBrackets(lines: string[]): number {
  let depth = 0;
  for (const line of lines) {
    for (const char of line) {
      if (char === "(" || char === "{" || char === "[") depth += 1;
      else if (char === ")" || char === "}" || char === "]") depth -= 1;
    }
  }
  return depth;
}

/**
 * Turns module-level code (everything outside top-level declarations) into "section" symbols,
 * so the storyline can show it as blocks, and moves module-level calls onto those sections.
 *
 * Comment/decorator-only paragraphs that sit directly above a declaration are merged into it
 * instead of becoming a section of their own.
 */
export function addSections(parsed: ParsedFile, content: string): ParsedFile {
  if (parsed.language === "plain") throw new Error(`Plain files are not split into sections: ${parsed.path}`);
  const rules = RULES[parsed.language];
  const sourceLines = content.split("\n");
  const symbols = parsed.symbols.map((symbol) => ({ ...symbol }));
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  // Every block counts as covered, including methods declared outside their type (Go, Rust impl, C++).
  const covered = coveredLines([...parsed.symbols, ...parsed.containerRanges]);
  const paragraphs = moduleParagraphs(sourceLines, covered).filter((paragraph) => !paragraph.lines.every((line) => isScaffolding(line, rules)));

  const sectionParagraphs: Paragraph[] = [];
  for (const paragraph of paragraphs) {
    const following = parsed.symbols.find((symbol) => symbol.startLine === paragraph.endLine + 1);
    if (following && paragraph.lines.every((line) => rules.prelude.test(line.trim()))) {
      const target = mustGet(symbolById, following.id, "Declaration symbol");
      target.startLine = paragraph.startLine;
      continue;
    }
    sectionParagraphs.push(paragraph);
  }

  const sections = groupIntoSections(parsed.path, sectionParagraphs, rules, covered);
  const fileNodeId = fileId(parsed.path);
  const calls = parsed.calls.map((call) => {
    if (call.fromId !== fileNodeId) return call;
    const section = sections.find((candidate) => call.line >= candidate.startLine && call.line <= candidate.endLine);
    return section ? { ...call, fromId: section.id } : call;
  });
  return { ...parsed, symbols: [...sections, ...symbols], calls };
}

function coveredLines(ranges: LineRange[]): Set<number> {
  const covered = new Set<number>();
  for (const range of ranges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) covered.add(line);
  }
  return covered;
}

function moduleParagraphs(sourceLines: string[], covered: Set<number>): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let current: Paragraph | null = null;
  sourceLines.forEach((text, index) => {
    const line = index + 1;
    const isBreak = covered.has(line) || text.trim() === "";
    if (isBreak) {
      current = null;
      return;
    }
    if (current === null) {
      current = { startLine: line, endLine: line, lines: [] };
      paragraphs.push(current);
    }
    current.endLine = line;
    current.lines.push(text);
  });
  return paragraphs;
}

function categoryOf(paragraph: Paragraph, rules: SectionRules): SectionCategory {
  const trimmed = paragraph.lines.map((line) => line.trim());
  if (rules.entry !== null && trimmed.some((line) => rules.entry !== null && rules.entry.test(line))) return "entry";
  if (rules.imports.test(at(trimmed, 0, "paragraph line"))) return "imports";
  // A paragraph may open with its doc comment; classify by its first line of code.
  const firstCode = trimmed.find((line) => !rules.prelude.test(line));
  return rules.types !== null && firstCode !== undefined && rules.types.test(firstCode) ? "types" : "setup";
}

/** Merges neighbouring paragraphs of the same category into one section symbol each. */
function groupIntoSections(path: string, paragraphs: Paragraph[], rules: SectionRules, covered: Set<number>): CodeSymbol[] {
  const sections: CodeSymbol[] = [];
  const usedNames = new Map<SectionCategory, number>();
  let previous: { category: SectionCategory; symbol: CodeSymbol; endLine: number; depth: number } | null = null;
  for (const paragraph of paragraphs) {
    const category = categoryOf(paragraph, rules);
    const continuesPrevious = previous !== null && (previous.category === category || previous.depth > 0);
    if (previous && continuesPrevious && !hasDeclarationBetween(previous.endLine, paragraph.startLine, covered)) {
      previous.symbol.endLine = paragraph.endLine;
      previous.endLine = paragraph.endLine;
      previous.depth += openBrackets(paragraph.lines);
      continue;
    }
    const occurrence = (usedNames.get(category) ?? 0) + 1;
    usedNames.set(category, occurrence);
    const name = occurrence === 1 ? SECTION_TITLES[category] : `${SECTION_TITLES[category]} ${occurrence}`;
    const qualifiedName = `§${name}`;
    const symbol: CodeSymbol = {
      id: symbolId(path, qualifiedName),
      name,
      qualifiedName,
      kind: "section",
      filePath: path,
      parentSymbolId: null,
      startLine: paragraph.startLine,
      endLine: paragraph.endLine,
      origin: "current",
    };
    sections.push(symbol);
    previous = { category, symbol, endLine: paragraph.endLine, depth: openBrackets(paragraph.lines) };
  }
  return sections;
}

/** True when a declaration (covered line) lies strictly between two module-level paragraphs. */
function hasDeclarationBetween(previousEnd: number, nextStart: number, covered: Set<number>): boolean {
  for (let line = previousEnd + 1; line < nextStart; line += 1) {
    if (covered.has(line)) return true;
  }
  return false;
}
