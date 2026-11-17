import { LANGUAGES, type Language } from "../../parse/language";

export type TokenKind = "keyword" | "string" | "comment" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

/**
 * Splits one line into keyword / string / comment / plain runs. Line-local on purpose: a
 * multi-line string or block comment shows as plain text on its later lines, which is acceptable
 * for a reading aid and keeps highlighting trivially cheap.
 */
export function tokenizeLine(line: string, language: Language): Token[] {
  const { lineComment, keywords } = LANGUAGES[language];
  const cStyle = lineComment === "//";
  const tokens: Token[] = [];
  let plain = "";
  const flushPlain = (): void => {
    if (plain !== "") tokens.push(...splitKeywords(plain, keywords));
    plain = "";
  };

  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const startsComment =
      (lineComment !== null && rest.startsWith(lineComment)) || (cStyle && (rest.startsWith("/*") || (i === 0 && /^\s*\*/.test(line))));
    if (startsComment) {
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
