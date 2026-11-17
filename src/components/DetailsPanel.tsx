import { useState } from "react";
import type { Analysis } from "../analysis/analyze";
import type { AiTask } from "../ai/claude";
import type { CodeNode, ReviewComment } from "../model/types";
import { ancestry } from "../graph/view";
import { mustGet } from "../util/assert";
import { KIND_ICONS, StatusPill } from "./common";

interface DetailsPanelProps {
  analysis: Analysis;
  nodeId: string;
  comments: ReviewComment[];
  aiAvailable: boolean;
  aiBusy: boolean;
  onAddComment: (nodeId: string, body: string) => void;
  onToggleResolved: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onAskAi: (nodeId: string, task: AiTask) => void;
  onOpen: (nodeId: string) => void;
  onReveal: (nodeId: string) => void;
}

/** Side panel for the selected folder, file or block: change info, review comments, AI actions. */
export function DetailsPanel(props: DetailsPanelProps) {
  const { analysis, nodeId, comments } = props;
  const node = mustGet(analysis.graph.nodes, nodeId, "Selected node");
  const change = analysis.changes.get(nodeId);
  const diff = node.kind === "file" ? analysis.diffByPath.get(node.path) : undefined;
  const ownComments = comments.filter((comment) => comment.nodeId === nodeId);
  const nestedComments = comments.filter(
    (comment) => comment.nodeId !== nodeId && analysis.graph.nodes.has(comment.nodeId) && ancestry(analysis.graph, comment.nodeId).includes(nodeId),
  );

  return (
    <aside className="details-panel" aria-label="Details">
      <header className="details-panel__header">
        <h2>
          <span aria-hidden="true">{iconFor(node)}</span> {titleFor(node)}
        </h2>
        <p className="muted">{locationFor(node)}</p>
        <div className="details-panel__status">
          <StatusPill status={change === undefined ? null : change.status} />
          {change !== undefined && change.changedDescendants > 0 && (
            <span className="muted">
              {change.changedDescendants} changed {node.kind === "folder" ? "files" : "blocks"} inside
            </span>
          )}
          {diff !== undefined && (
            <span className="muted">
              +{diff.addedCount} / −{diff.removedCount}
            </span>
          )}
        </div>
        {node.kind !== "symbol" && (
          <button className="primary-button" onClick={() => props.onOpen(nodeId)}>
            {node.kind === "file" ? "Read storyline" : "Open folder"}
          </button>
        )}
      </header>

      {node.kind !== "folder" && (
        <section className="details-panel__section">
          <h3>Ask Claude</h3>
          {props.aiAvailable ? (
            <div className="button-row">
              <button className="small-button" disabled={props.aiBusy} onClick={() => props.onAskAi(nodeId, "explain")}>
                Explain
              </button>
              <button className="small-button" disabled={props.aiBusy} onClick={() => props.onAskAi(nodeId, "review")}>
                Suggest review notes
              </button>
            </div>
          ) : (
            <p className="muted">Add a Claude API key in Settings to get explanations and review suggestions.</p>
          )}
        </section>
      )}

      <section className="details-panel__section">
        <h3>Comments</h3>
        {ownComments.length === 0 && <p className="muted">No comments on this {node.kind === "symbol" ? "block" : node.kind} yet.</p>}
        <ul className="comment-list">
          {ownComments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} onToggle={props.onToggleResolved} onDelete={props.onDeleteComment} />
          ))}
        </ul>
        <CommentForm onSubmit={(body) => props.onAddComment(nodeId, body)} />
      </section>

      {nestedComments.length > 0 && (
        <section className="details-panel__section">
          <h3>Comments inside</h3>
          <ul className="comment-list">
            {nestedComments.map((comment) => (
              <li key={comment.id} className={comment.resolved ? "comment is-resolved" : "comment"}>
                <button className="link-button" onClick={() => props.onReveal(comment.nodeId)}>
                  {titleFor(mustGet(analysis.graph.nodes, comment.nodeId, "Comment node"))}
                </button>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff !== undefined && diff.patch !== "" && (
        <section className="details-panel__section">
          <h3>Diff</h3>
          <pre className="diff-view">
            {diff.patch.split("\n").map((line, index) => (
              <div key={index} className={diffLineClass(line)}>
                {line === "" ? " " : line}
              </div>
            ))}
          </pre>
        </section>
      )}
    </aside>
  );
}

function CommentItem({ comment, onToggle, onDelete }: { comment: ReviewComment; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <li className={comment.resolved ? "comment is-resolved" : "comment"}>
      <div className="comment__meta">
        <span className={`source-tag source-tag--${comment.source}`}>{comment.source === "ai" ? "Claude" : "You"}</span>
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
      </div>
      <p className="comment__body">{comment.body}</p>
      <div className="comment__actions edit-only">
        <button className="link-button" onClick={() => onToggle(comment.id)}>
          {comment.resolved ? "Reopen" : "Resolve"}
        </button>
        <button className="link-button danger" onClick={() => onDelete(comment.id)}>
          Delete
        </button>
      </div>
    </li>
  );
}

function CommentForm({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [body, setBody] = useState("");
  const submit = (): void => {
    if (body.trim() === "") return;
    onSubmit(body.trim());
    setBody("");
  };
  return (
    <form
      className="comment-form edit-only"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        value={body}
        rows={3}
        placeholder="Leave a review note on this block…"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
        }}
      />
      <button className="primary-button" type="submit" disabled={body.trim() === ""}>
        Comment
      </button>
    </form>
  );
}

function iconFor(node: CodeNode): string {
  return node.symbol === null ? KIND_ICONS[node.kind] : KIND_ICONS[node.symbol.kind];
}

function titleFor(node: CodeNode): string {
  if (node.symbol === null) return node.label;
  return node.symbol.kind === "section" ? `${node.symbol.name} (${node.symbol.filePath})` : node.symbol.qualifiedName;
}

function locationFor(node: CodeNode): string {
  if (node.symbol === null) return node.path === "" ? "Project root" : node.path;
  const { symbol } = node;
  return `${symbol.filePath} · lines ${symbol.startLine}–${symbol.endLine}`;
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "diff-line diff-line--hunk";
  if (line.startsWith("+")) return "diff-line diff-line--added";
  if (line.startsWith("-")) return "diff-line diff-line--removed";
  return "diff-line";
}
