import ts from "typescript";
import { analyzeWithTypeScript, type Analysis } from "../analysis/analyze";
import type { FileDiff, SourceFile } from "../model/types";

/** Joins lines so fixtures read like real files (line numbers = array index + 1). */
export function lines(...source: string[]): string {
  return source.join("\n");
}

export function analyze(files: SourceFile[], diff: FileDiff[] = []): Analysis {
  return analyzeWithTypeScript(ts, { id: "test", title: "test", files, diff });
}
