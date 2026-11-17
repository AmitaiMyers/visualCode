import type { CodeSymbol, Language, ParsedFile } from "../model/types";
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

const TS_IMPORT = /^(import\s|export\s.*\sfrom\s|(const|let|var)\s+\w+\s*=\s*require\()/;
const TS_TYPE_DECLARATION = /^(export\s+)?(declare\s+)?(interface|type|enum|const\s+enum)\s/;

/**
 * Turns module-level code (everything outside top-level declarations) into "section" symbols,
 * so the storyline can show it as blocks, and moves module-level calls onto those sections.
 *
 * Comment/decorator-only paragraphs that sit directly above a declaration are merged into it
 * instead of becoming a section of their own.
 */
export function addSections(parsed: ParsedFile, content: string): ParsedFile {
  const sourceLines = content.split("\n");
  const topLevel = parsed.symbols
    .filter((symbol) => symbol.parentSymbolId === null)
    .sort((a, b) => a.startLine - b.startLine);

  const symbols = parsed.symbols.map((symbol) => ({ ...symbol }));
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const covered = coveredLines(topLevel);
  const paragraphs = moduleParagraphs(sourceLines, covered);

  const sectionParagraphs: Paragraph[] = [];
  for (const paragraph of paragraphs) {
    const following = topLevel.find((symbol) => symbol.startLine === paragraph.endLine + 1);
    if (following && isPreludeOnly(paragraph.lines, parsed.language)) {
      const target = mustGet(symbolById, following.id, "Declaration symbol");
      target.startLine = paragraph.startLine;
      continue;
    }
    sectionParagraphs.push(paragraph);
  }

  const sections = groupIntoSections(parsed.path, sectionParagraphs, parsed.language, covered);
  const fileNodeId = fileId(parsed.path);
  const calls = parsed.calls.map((call) => {
    if (call.fromId !== fileNodeId) return call;
    const section = sections.find((candidate) => call.line >= candidate.startLine && call.line <= candidate.endLine);
    return section ? { ...call, fromId: section.id } : call;
  });
  return { ...parsed, symbols: [...sections, ...symbols], calls };
}

function coveredLines(topLevel: CodeSymbol[]): Set<number> {
  const covered = new Set<number>();
  for (const symbol of topLevel) {
    for (let line = symbol.startLine; line <= symbol.endLine; line += 1) covered.add(line);
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

function isPreludeOnly(lines: string[], language: Language): boolean {
  const preludePrefixes = language === "py" ? ["#", "@"] : ["//", "/*", "*", "@"];
  return lines.every((line) => preludePrefixes.some((prefix) => line.trim().startsWith(prefix)));
}

function categoryOf(paragraph: Paragraph, language: Language): SectionCategory {
  const first = at(paragraph.lines, 0, "paragraph line").trim();
  if (language === "py") {
    if (paragraph.lines.some((line) => /^if\s+__name__\s*==/.test(line.trim()))) return "entry";
    return /^(import|from)\s/.test(first) ? "imports" : "setup";
  }
  if (TS_IMPORT.test(first)) return "imports";
  // A paragraph may open with its doc comment; classify by its first line of code.
  const firstCode = paragraph.lines.map((line) => line.trim()).find((line) => !/^(\/\/|\/\*|\*)/.test(line));
  return firstCode !== undefined && TS_TYPE_DECLARATION.test(firstCode) ? "types" : "setup";
}

/** Merges neighbouring paragraphs of the same category into one section symbol each. */
function groupIntoSections(path: string, paragraphs: Paragraph[], language: Language, covered: Set<number>): CodeSymbol[] {
  const sections: CodeSymbol[] = [];
  const usedNames = new Map<SectionCategory, number>();
  let previous: { category: SectionCategory; symbol: CodeSymbol; endLine: number } | null = null;
  for (const paragraph of paragraphs) {
    const category = categoryOf(paragraph, language);
    if (previous && previous.category === category && !hasDeclarationBetween(previous.endLine, paragraph.startLine, covered)) {
      previous.symbol.endLine = paragraph.endLine;
      previous.endLine = paragraph.endLine;
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
    };
    sections.push(symbol);
    previous = { category, symbol, endLine: paragraph.endLine };
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
