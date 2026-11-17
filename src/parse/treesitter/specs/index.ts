import type { Language } from "../../language";
import type { LanguageSpec } from "../extract";
import { cSpec, cppSpec, csharpSpec } from "./cFamily";
import { goSpec, rustSpec } from "./goRust";
import { javaSpec, kotlinSpec } from "./jvm";
import { phpSpec, rubySpec, swiftSpec } from "./scripting";

/** The Tree-sitter reading rules for every grammar-based language. */
export const LANGUAGE_SPECS: Partial<Record<Language, LanguageSpec>> = {
  java: javaSpec,
  kotlin: kotlinSpec,
  go: goSpec,
  csharp: csharpSpec,
  rust: rustSpec,
  c: cSpec,
  cpp: cppSpec,
  php: phpSpec,
  ruby: rubySpec,
  swift: swiftSpec,
};
