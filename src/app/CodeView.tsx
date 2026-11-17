import type { CodeNode } from "../model/types";
import { useAnalysis } from "../state/workspace";
import { mustGet } from "../util/assert";
import styles from "./CodeView.module.css";

/** Full source of a block (its line range) or a whole file, with changed lines marked. */
export function CodeView({ node }: { node: CodeNode }) {
  const analysis = useAnalysis();
  const lines = mustGet(analysis.contents, node.path, "File content").split("\n");
  const start = node.symbol === null ? 1 : node.symbol.startLine;
  const end = node.symbol === null ? lines.length : node.symbol.endLine;
  const diff = analysis.diffByPath.get(node.path);
  const added = new Set(diff === undefined ? [] : diff.addedLines);
  const removals = new Set(diff === undefined ? [] : diff.removalAnchors);

  return (
    <pre className={styles.code} aria-label={`Source, lines ${start} to ${end}`}>
      {lines.slice(start - 1, end).map((text, index) => {
        const line = start + index;
        const classes = [styles.line, added.has(line) ? styles.added : "", removals.has(line) ? styles.removal : ""].join(" ");
        return (
          <div key={line} className={classes}>
            <span className={styles.number}>{line}</span>
            <span className={styles.text}>{text === "" ? " " : text}</span>
          </div>
        );
      })}
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
