import type { Language } from "../model/types";
import { basename } from "../util/paths";

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  cts: "ts",
  js: "ts",
  jsx: "ts",
  mjs: "ts",
  cjs: "ts",
  py: "py",
};

/** Folders that never hold reviewable project source. */
const IGNORED_FOLDERS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
]);

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES = 2000;

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function languageOf(path: string): Language | null {
  const language = LANGUAGE_BY_EXTENSION[extensionOf(path)];
  return language === undefined ? null : language;
}

function isMinified(path: string): boolean {
  return /\.min\.[cm]?js$/i.test(path) || path.endsWith(".d.ts");
}

/** True when a path should be loaded and parsed. */
export function isSupportedSourcePath(path: string): boolean {
  if (languageOf(path) === null || isMinified(path)) return false;
  return path.split("/").every((segment) => !IGNORED_FOLDERS.has(segment));
}
