import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, ChevronsDownUp, MessageSquare, X } from "lucide-react";
import type { ChangeStatus, Language } from "../../model/types";
import type { StoryBlock } from "../../graph/story";
import { KindGlyph, StatusBadge, StepBadge } from "../../ui/Badges";
import { tokenizeLine } from "./highlight";
import { CARD_WIDTH, FOOTER_HEIGHT, HEADER_HEIGHT, LINE_HEIGHT, MAX_COLLAPSED_LINES, lineOffset, type CardGeometry } from "./storyLayout";
import styles from "./StoryCanvas.module.css";

export interface BlockCardData extends Record<string, unknown> {
  block: StoryBlock;
  geometry: CardGeometry;
  language: Language;
  lines: string[];
  addedLines: ReadonlySet<number>;
  removalAnchors: ReadonlySet<number>;
  callLines: number[];
  status: ChangeStatus | null;
  viewed: boolean;
  reviewable: boolean; // shows the "Mark viewed" toggle
  noteCount: number;
  selected: boolean;
  traceState: "rest" | "traced" | "dimmed";
  hoveredLine: number | null;
  enterDelayMs: number | null;
  onToggleOpen: (nodeId: string) => void;
  onCollapseForeign: (nodeId: string) => void;
  onToggleViewed: (nodeId: string) => void;
  onLineHover: (nodeId: string, line: number | null) => void;
  onFollowLine: (nodeId: string, line: number) => void;
}

export type BlockCardNode = Node<BlockCardData, "block">;

/** One block of code in the storyline: header (step, kind, name, status) over its real source lines. */
export const BlockCard = memo(function BlockCard({ data }: NodeProps<BlockCardNode>) {
  const { block, geometry, lines, addedLines, removalAnchors, callLines, status, selected } = data;
  const callLineSet = new Set(callLines);
  const total = block.displayEnd - block.displayStart + 1;
  const classes = [
    styles.card,
    status === "added" ? styles.cardAdded : "",
    status === "modified" || status === "renamed" ? styles.cardModified : "",
    block.foreign ? styles.cardForeign : "",
    selected ? styles.cardSelected : "",
    data.viewed ? styles.cardViewed : "",
    styles[`trace-${data.traceState}`],
    data.enterDelayMs === null ? "" : styles.entering,
  ];

  return (
    <div
      className={classes.join(" ")}
      style={{ width: CARD_WIDTH, height: geometry.height, animationDelay: data.enterDelayMs === null ? undefined : `${data.enterDelayMs}ms` }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ top: HEADER_HEIGHT / 2 }} isConnectable={false} />
      <header className={styles.cardHead} style={{ height: HEADER_HEIGHT }}>
        <StepBadge step={block.step} variant={data.viewed ? "done" : "filled"} />
        <KindGlyph kind={block.symbol.kind} />
        <span className={styles.cardName} title={block.symbol.qualifiedName}>
          {block.symbol.kind === "section" ? block.symbol.name : block.symbol.qualifiedName}
        </span>
        {block.foreign && (
          <span className={styles.cardFile} title={block.symbol.filePath}>
            {block.symbol.filePath}
          </span>
        )}
        <span className={styles.cardMeta}>
          {status !== null && <StatusBadge status={status} viewed={data.viewed} />}
          {data.noteCount > 0 && (
            <span className={styles.noteCount} aria-label={`${data.noteCount} open notes`}>
              <MessageSquare size={13} aria-hidden="true" />
              {data.noteCount}
            </span>
          )}
          {data.reviewable && (
            <button
              type="button"
              className={`${styles.headButton} nodrag edit-only`}
              aria-pressed={data.viewed}
              data-tooltip={data.viewed ? "Viewed · click to undo" : "Mark viewed · V"}
              aria-label={data.viewed ? "Mark not viewed" : "Mark viewed"}
              onClick={(event) => {
                event.stopPropagation();
                data.onToggleViewed(block.nodeId);
              }}
            >
              <Check size={14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
          {!geometry.truncated && total > MAX_COLLAPSED_LINES && (
            <button
              type="button"
              className={`${styles.headButton} nodrag`}
              data-tooltip="Fold"
              aria-label="Fold long block"
              onClick={(event) => {
                event.stopPropagation();
                data.onToggleOpen(block.nodeId);
              }}
            >
              <ChevronsDownUp size={14} aria-hidden="true" />
            </button>
          )}
          {block.foreign && (
            <button
              type="button"
              className={`${styles.headButton} nodrag`}
              data-tooltip="Collapse to a reference"
              aria-label="Collapse to a reference"
              onClick={(event) => {
                event.stopPropagation();
                data.onCollapseForeign(block.nodeId);
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      </header>
      <pre className={styles.code}>
        {lines.map((text, index) => {
          const line = block.displayStart + index;
          const isCall = callLineSet.has(line);
          const lineClasses = [
            styles.line,
            addedLines.has(line) ? styles.lineAdded : "",
            removalAnchors.has(line) ? styles.lineRemoval : "",
            isCall ? styles.lineCall : "",
            isCall && data.hoveredLine === line ? styles.lineCallHover : "",
          ];
          return (
            <div
              key={line}
              className={lineClasses.join(" ")}
              style={{ height: LINE_HEIGHT }}
              onMouseEnter={isCall ? () => data.onLineHover(block.nodeId, line) : undefined}
              onMouseLeave={isCall ? () => data.onLineHover(block.nodeId, null) : undefined}
              onClick={
                isCall
                  ? (event) => {
                      event.stopPropagation();
                      data.onFollowLine(block.nodeId, line);
                    }
                  : undefined
              }
              title={isCall ? "Follow this call" : undefined}
            >
              <span className={styles.lineNumber}>{line}</span>
              <span className={styles.lineText}>
                {text === "" ? " " : tokenizeLine(text, data.language).map((token, tokenIndex) => <span key={tokenIndex} className={styles[`tok-${token.kind}`]}>{token.text}</span>)}
              </span>
            </div>
          );
        })}
      </pre>
      {geometry.truncated && (
        <button
          type="button"
          className={`${styles.more} nodrag`}
          style={{ height: FOOTER_HEIGHT }}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleOpen(block.nodeId);
          }}
        >
          Show all {total} lines
        </button>
      )}
      {callLines.map((line) => (
        <Handle
          key={line}
          type="source"
          position={Position.Right}
          id={`L${line}`}
          isConnectable={false}
          className="is-call-dot"
          style={{ top: lineOffset(block, geometry.shownLines, geometry.truncated, line) }}
        />
      ))}
    </div>
  );
});
