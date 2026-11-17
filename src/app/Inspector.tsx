import { useState } from "react";
import { ArrowRight, Check, KeyRound, MessageSquare, Sparkles, X } from "lucide-react";
import { askClaude, type AiTask } from "../ai/claude";
import type { CodeNode, ReviewComment } from "../model/types";
import { ancestry } from "../graph/view";
import { newComment } from "../review/reviewStore";
import { useAnalysis, useDispatch, useNavigation, useReview, useWorkspace } from "../state/workspace";
import { errorMessage, mustGet } from "../util/assert";
import { KindGlyph, StatusBadge, kindWord } from "../ui/Badges";
import { Button, IconButton } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useToast } from "../ui/Toasts";
import { LANGUAGES } from "../parse/language";
import { CodeView, DiffView } from "./CodeView";
import { NOTE_COMPOSER_ID } from "./useWorkspaceShortcuts";
import styles from "./Inspector.module.css";

type Tab = "notes" | "code" | "diff";

interface InspectorProps {
  reviewEnabled: boolean;
  aiKey: string;
  onAddApiKey: () => void;
}

/** Details for the selected block, file or folder (or the current scope when nothing is selected). */
export function Inspector({ reviewEnabled, aiKey, onAddApiKey }: InspectorProps) {
  const analysis = useAnalysis();
  const { scopeId, selectedId } = useWorkspace();
  const nodeId = selectedId ?? scopeId;
  const node = mustGet(analysis.graph.nodes, nodeId, "Inspected node");
  // Remount per node so tabs and drafts reset when the selection changes.
  return <InspectorBody key={nodeId} node={node} reviewEnabled={reviewEnabled} aiKey={aiKey} onAddApiKey={onAddApiKey} />;
}

function InspectorBody({ node, reviewEnabled, aiKey, onAddApiKey }: InspectorProps & { node: CodeNode }) {
  const analysis = useAnalysis();
  const { scopeId, viewed } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const review = useReview();
  const [tab, setTab] = useState<Tab>("notes");

  const change = analysis.changes.get(node.id);
  const diff = node.kind === "folder" ? undefined : analysis.diffByPath.get(node.path);
  const hasCode = node.kind !== "folder" && analysis.contents.has(node.path);
  const isReviewItem = reviewEnabled && review !== null && review.items.some((item) => item.nodeId === node.id);
  const isViewed = viewed.has(node.id);

  const tabs: { value: Tab; label: string }[] = [{ value: "notes", label: "Notes" }];
  if (hasCode) tabs.push({ value: "code", label: "Code" });
  if (diff !== undefined && diff.patch !== "") tabs.push({ value: "diff", label: "Diff" });

  const openAction = openActionFor(node, scopeId);

  return (
    <aside className={styles.inspector} aria-label="Details">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          {node.symbol !== null ? <KindGlyph kind={node.symbol.kind} /> : <KindGlyph kind={node.kind} />}
          <h2 className={styles.title}>{titleOf(node)}</h2>
          <IconButton icon={X} label="Close details" shortcut="Esc" onClick={() => dispatch({ type: "setInspectorOpen", open: false })} />
        </div>
        <p className={styles.location}>{locationOf(node)}</p>
        <div className={styles.meta}>
          {change !== undefined && change.status !== null && <StatusBadge status={change.status} />}
          {change !== undefined && change.changedDescendants > 0 && (
            <span className="caption">
              {change.changedDescendants} changed {node.kind === "folder" ? (change.changedDescendants === 1 ? "file" : "files") : "blocks"} inside
            </span>
          )}
          {diff !== undefined && node.kind === "file" && (
            <span className={styles.diffStat}>
              <span className={styles.plus}>+{diff.addedCount}</span> <span className={styles.minus}>−{diff.removedCount}</span>
            </span>
          )}
        </div>
        {(openAction !== null || isReviewItem) && (
          <div className={styles.actions}>
            {openAction !== null && (
              <Button variant="primary" size="sm" icon={ArrowRight} onClick={() => navigation.open(openAction.targetId)}>
                {openAction.label}
              </Button>
            )}
            {isReviewItem && (
              <Button
                variant={isViewed ? "ghost" : "secondary"}
                size="sm"
                icon={Check}
                onClick={() => dispatch({ type: "setViewed", nodeId: node.id, viewed: !isViewed })}
                className="edit-only"
              >
                {isViewed ? "Viewed · undo" : "Mark viewed"}
              </Button>
            )}
          </div>
        )}
      </header>

      {tabs.length > 1 && (
        <div className={styles.tabs}>
          <SegmentedControl label="Details view" value={tab} onChange={setTab} segments={tabs} />
        </div>
      )}

      <div className={styles.body}>
        {tab === "notes" && <NotesPanel node={node} aiKey={aiKey} onAddApiKey={onAddApiKey} />}
        {tab === "code" && <CodeView node={node} />}
        {tab === "diff" && diff !== undefined && <DiffView patch={diff.patch} />}
      </div>
    </aside>
  );
}

function openActionFor(node: CodeNode, scopeId: string): { label: string; targetId: string } | null {
  if (node.id === scopeId) return null;
  if (node.kind === "folder") return { label: "Open folder", targetId: node.id };
  if (node.kind === "file") return { label: "Read storyline", targetId: node.id };
  return null;
}

// ---------------------------------------------------------------------------

function NotesPanel({ node, aiKey, onAddApiKey }: { node: CodeNode; aiKey: string; onAddApiKey: () => void }) {
  const analysis = useAnalysis();
  const { comments } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const toast = useToast();
  const [aiTask, setAiTask] = useState<AiTask | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const own = comments.filter((comment) => comment.nodeId === node.id);
  const nested = comments.filter(
    (comment) => comment.nodeId !== node.id && analysis.graph.nodes.has(comment.nodeId) && ancestry(analysis.graph, comment.nodeId).includes(node.id),
  );

  const ask = (task: AiTask): void => {
    setAiTask(task);
    setAiError(null);
    askClaude(aiKey, analysis, node, task)
      .then((answer) => {
        dispatch({ type: "addComment", comment: newComment(node.id, answer, "ai") });
        toast({ message: "Claude added a note", tone: "success" });
      })
      .catch((reason: unknown) => setAiError(errorMessage(reason)))
      .finally(() => setAiTask(null));
  };

  const remove = (comment: ReviewComment): void => {
    dispatch({ type: "removeComment", commentId: comment.id });
    toast({ message: "Note deleted", action: { label: "Undo", run: () => dispatch({ type: "addComment", comment }) } });
  };

  const noKey = aiKey === "" ? "Add a Claude API key in Settings" : null;

  return (
    <div className={styles.notes}>
      {node.kind !== "folder" && (
        <section className={styles.section} aria-label="Ask Claude">
          <span className="label">Ask Claude</span>
          <div className={styles.aiRow}>
            <Button size="sm" icon={Sparkles} loading={aiTask === "explain"} disabledReason={noKey} onClick={() => ask("explain")}>
              Explain
            </Button>
            <Button size="sm" icon={Sparkles} loading={aiTask === "review"} disabledReason={noKey} onClick={() => ask("review")}>
              Suggest review notes
            </Button>
            {noKey !== null && (
              <Button size="sm" variant="ghost" icon={KeyRound} onClick={onAddApiKey}>
                Add key
              </Button>
            )}
          </div>
          {aiError !== null && (
            <p className={styles.error} role="alert">
              {aiError}
            </p>
          )}
        </section>
      )}

      <section className={styles.section} aria-label="Notes">
        <span className="label">Notes</span>
        {own.length === 0 && <p className="caption">No notes on this {node.kind === "symbol" ? "block" : node.kind} yet.</p>}
        <ul className={styles.noteList}>
          {own.map((comment) => (
            <NoteItem
              key={comment.id}
              comment={comment}
              onToggle={() => dispatch({ type: "toggleResolved", commentId: comment.id })}
              onDelete={() => remove(comment)}
            />
          ))}
        </ul>
        <Composer onSubmit={(body) => dispatch({ type: "addComment", comment: newComment(node.id, body, "human") })} placeholder={`Write a note on ${titleOf(node)}…`} />
      </section>

      {nested.length > 0 && (
        <section className={styles.section} aria-label="Notes inside">
          <span className="label">Notes inside</span>
          <ul className={styles.noteList}>
            {nested.map((comment) => (
              <li key={comment.id} className={comment.resolved ? `${styles.note} ${styles.resolved}` : styles.note}>
                <button type="button" className={styles.noteLink} onClick={() => navigation.open(comment.nodeId)}>
                  <MessageSquare size={12} aria-hidden="true" />
                  {titleOf(mustGet(analysis.graph.nodes, comment.nodeId, "Note target"))}
                </button>
                <p className={styles.noteBody}>{comment.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NoteItem({ comment, onToggle, onDelete }: { comment: ReviewComment; onToggle: () => void; onDelete: () => void }) {
  const isAi = comment.source === "ai";
  return (
    <li className={comment.resolved ? `${styles.note} ${styles.resolved}` : styles.note}>
      <div className={styles.noteMeta}>
        <span className={isAi ? `${styles.who} ${styles.ai}` : styles.who}>
          {isAi && <Sparkles size={12} aria-hidden="true" />}
          {isAi ? "Claude" : "You"}
        </span>
        <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>
        {comment.resolved && <span>· resolved</span>}
      </div>
      <p className={styles.noteBody}>{comment.body}</p>
      <div className={`${styles.noteActions} edit-only`}>
        <button type="button" className={styles.link} onClick={onToggle}>
          {comment.resolved ? "Reopen" : "Resolve"}
        </button>
        <button type="button" className={`${styles.link} ${styles.danger}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

function Composer({ onSubmit, placeholder }: { onSubmit: (body: string) => void; placeholder: string }) {
  const [body, setBody] = useState("");
  const submit = (): void => {
    if (body.trim() === "") return;
    onSubmit(body.trim());
    setBody("");
  };
  return (
    <form
      className={`${styles.composer} edit-only`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        id={NOTE_COMPOSER_ID}
        value={body}
        rows={Math.min(8, Math.max(2, body.split("\n").length))}
        placeholder={placeholder}
        aria-label="New note"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") event.currentTarget.blur();
        }}
      />
      <div className={styles.composerBar}>
        <span className="caption">Ctrl/⌘ + Enter to add</span>
        <Button type="submit" variant="primary" size="sm" disabledReason={body.trim() === "" ? "Write something first" : null}>
          Add note
        </Button>
      </div>
    </form>
  );
}

export function titleOf(node: CodeNode): string {
  if (node.symbol === null) return node.label;
  return node.symbol.kind === "section" ? `${node.symbol.name} (module code)` : node.symbol.qualifiedName;
}

function locationOf(node: CodeNode): string {
  const language = node.language === null ? null : LANGUAGES[node.language].label;
  if (node.symbol === null) {
    return node.kind === "folder" ? `Folder · ${node.path === "" ? "project root" : node.path}` : `${language ?? "File"} · ${node.path}`;
  }
  const { symbol } = node;
  return `${kindWord(symbol.kind)} · ${language ?? ""} · ${symbol.filePath} · lines ${symbol.startLine}–${symbol.endLine}`;
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}
