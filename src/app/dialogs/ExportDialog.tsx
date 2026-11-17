import { useMemo, useRef } from "react";
import { Copy, FileJson, FileText, Upload } from "lucide-react";
import { downloadText, exportJson, exportMarkdown, parseReviewJson } from "../../review/reviewStore";
import { useAnalysis, useDispatch, useReview, useWorkspace } from "../../state/workspace";
import { errorMessage } from "../../util/assert";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { useToast } from "../../ui/Toasts";
import styles from "./dialogs.module.css";

/** Summary of the review plus ways to take it elsewhere: copy as Markdown, download, import. */
export function ExportDialog({ reviewEnabled, onClose }: { reviewEnabled: boolean; onClose: () => void }) {
  const analysis = useAnalysis();
  const { comments } = useWorkspace();
  const dispatch = useDispatch();
  const review = useReview();
  const toast = useToast();
  const importInput = useRef<HTMLInputElement>(null);

  const summary = reviewEnabled && review !== null ? { changedBlocks: review.items.length, viewedBlocks: review.viewedCount } : null;
  const markdown = useMemo(
    () => exportMarkdown(analysis.project.title, analysis.graph, comments, summary),
    [analysis, comments, summary],
  );
  const openNotes = comments.filter((comment) => !comment.resolved).length;
  const fileBase = analysis.project.title.replace(/[^\w.-]+/g, "-");

  const copy = (): void => {
    navigator.clipboard.writeText(markdown).then(
      () => toast({ message: "Review copied as Markdown", tone: "success" }),
      () => toast({ message: "Copying was blocked by the browser. Use Download .md instead.", tone: "error" }),
    );
  };

  return (
    <Dialog title="Export review" description={analysis.project.title} width="wide" onClose={onClose}>
      <div className={styles.summary}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{comments.length}</span>
          <span className="caption">notes</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{openNotes}</span>
          <span className="caption">still open</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{summary === null ? "–" : `${summary.viewedBlocks}/${summary.changedBlocks}`}</span>
          <span className="caption">{summary === null ? "no review checklist" : "changed blocks viewed"}</span>
        </div>
      </div>

      <section className={styles.group} aria-label="Markdown preview">
        <span className="label">Markdown</span>
        <pre className={styles.preview}>{markdown}</pre>
      </section>

      <div className={styles.row}>
        <Button variant="primary" icon={Copy} onClick={copy}>
          Copy as Markdown
        </Button>
        <Button icon={FileText} onClick={() => downloadText(`${fileBase}.review.md`, markdown, "text/markdown")}>
          Download .md
        </Button>
        <Button icon={FileJson} onClick={() => downloadText(`${fileBase}.review.json`, exportJson(analysis.project.id, comments), "application/json")}>
          Download .json
        </Button>
        <Button variant="ghost" icon={Upload} onClick={() => importInput.current?.click()} className="edit-only">
          Import .json
        </Button>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.item(0);
            event.target.value = "";
            if (file === undefined || file === null) return;
            file
              .text()
              .then((text) => {
                const imported = parseReviewJson(text);
                dispatch({ type: "mergeComments", comments: imported.comments });
                const from = imported.projectId === analysis.project.id ? "" : ` from ${imported.projectId}`;
                toast({ message: `Imported ${imported.comments.length} notes${from}`, tone: "success" });
              })
              .catch((reason: unknown) => toast({ message: `Import failed: ${errorMessage(reason)}`, tone: "error" }));
          }}
        />
      </div>
    </Dialog>
  );
}
