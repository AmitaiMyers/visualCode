import type { CodeNode } from "../model/types";
import { fileLines, removedLinesAbove } from "../analysis/source";
import { cardRows } from "../canvas/story/storyLayout";
import { useAnalysis, useWorkspace } from "../state/workspace";
import styles from "./CodeView.module.css";

/**
 * Full source of a block (its line range) or a whole file, with changed lines marked. Removed lines show
 * inline when the reader has them on; a deleted block shows its old source.
 */
export function CodeView({ node }: { node: CodeNode }) {
  const analysis = useAnalysis();
  const { showRemoved } = useWorkspace();
  const origin = node.symbol === null ? "current" : node.symbol.origin;
  const lines = fileLines(analysis, node.path, origin);
  const start = node.symbol === null ? 1 : node.symbol.startLine;
  const end = node.symbol === null ? lines.length : node.symbol.endLine;
  const removedBlock = origin === "removed";
  const diff = removedBlock ? undefined : analysis.diffByPath.get(node.path);
  const added = new Set(diff === undefined ? [] : diff.addedLines);
  const removals = new Set(diff === undefined || showRemoved ? [] : diff.removalAnchors);
  const rows = cardRows(start, lines.slice(start - 1, end), showRemoved && !removedBlock ? removedLinesAbove(analysis, node.path) : () => []);

  return (
    <pre className={`${styles.code} ${removedBlock ? styles.removedBlock : ""}`} aria-label={`${removedBlock ? "Deleted source" : "Source"}, lines ${start} to ${end}`}>
      {rows.map((row) =>
        row.kind === "removed" ? (
          <div key={`-${row.oldLine}`} className={`${styles.line} ${styles.deleted}`} title={`Removed (old line ${row.oldLine})`}>
            <span className={styles.number} aria-hidden="true">−</span>
            <span className={styles.text}>{row.text === "" ? " " : row.text}</span>
          </div>
        ) : (
          <div key={row.line} className={[styles.line, added.has(row.line) ? styles.added : "", removals.has(row.line) ? styles.removal : ""].join(" ")}>
            <span className={styles.number}>{row.line}</span>
            <span className={styles.text}>{row.text === "" ? " " : row.text}</span>
          </div>
        ),
      )}
    </pre>
  );
}

/** A file's patch with added, removed and hunk lines coloured. */
export function DiffView({ patch }: { patch: string }) {
  return (
    <pre className={styles.code} aria-label="Diff">
      {patch.split("\n").map((line, index) => (
        <div key={index} className={`${styles.diffLine} ${diffClass(line)}`}>
          {line === "" ? " " : line}
        </div>
      ))}
    </pre>
  );
}

function diffClass(line: string): string {
  if (line.startsWith("@@")) return styles.hunk ?? "";
  if (line.startsWith("+")) return styles.added ?? "";
  if (line.startsWith("-")) return styles.deleted ?? "";
  return "";
}
