import type { Language } from "../../model/types";

export type TokenKind = "keyword" | "string" | "comment" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS: Record<Language, ReadonlySet<string>> = {
  ts: new Set(
    "abstract as async await break case catch class const continue default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield".split(
      " ",
    ),
  ),
  py: new Set(
    "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield".split(" "),
  ),
};

/**
 * Splits one line into keyword / string / comment / plain runs. Line-local on purpose: a
 * multi-line string or block comment shows as plain text on its later lines, which is acceptable
 * for a reading aid and keeps highlighting trivially cheap.
 */
export function tokenizeLine(line: string, language: Language): Token[] {
  const commentStart = language === "py" ? "#" : "//";
  const tokens: Token[] = [];
  let plain = "";
  const flushPlain = (): void => {
    if (plain !== "") tokens.push(...splitKeywords(plain, KEYWORDS[language]));
    plain = "";
  };

  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith(commentStart) || (language === "ts" && (rest.startsWith("/*") || /^\s*\*/.test(line) && i === 0))) {
      flushPlain();
      tokens.push({ text: rest, kind: "comment" });
      return tokens;
    }
    const char = line.charAt(i);
    if (char === '"' || char === "'" || char === "`") {
      flushPlain();
      const end = closingQuote(line, i, char);
      tokens.push({ text: line.slice(i, end), kind: "string" });
      i = end;
      continue;
    }
    plain += char;
    i += 1;
  }
  flushPlain();
  return tokens;
}

function closingQuote(line: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < line.length) {
    const char = line.charAt(i);
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i += 1;
  }
  return line.length;
}

function splitKeywords(text: string, keywords: ReadonlySet<string>): Token[] {
  return text
    .split(/(\b[A-Za-z_]\w*\b)/)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, kind: keywords.has(part) ? "keyword" : "plain" }));
}
