import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ChangeStatus } from "../../model/types";
import type { StoryBlock } from "../../graph/story";
import { CARD_WIDTH, FOOTER_HEIGHT, HEADER_HEIGHT, LINE_HEIGHT, MAX_COLLAPSED_LINES, lineOffset, type CardGeometry } from "./storyLayout";
import { KIND_ICONS, StatusPill } from "../common";

export interface BlockCardData extends Record<string, unknown> {
  block: StoryBlock;
  geometry: CardGeometry;
  lines: string[]; // source lines shown on the card
  addedLines: ReadonlySet<number>;
  removalAnchors: ReadonlySet<number>;
  callLines: number[]; // distinct lines with outgoing arrows
  status: ChangeStatus | null;
  commentCount: number;
  selected: boolean;
  onToggleOpen: (nodeId: string) => void;
  onCollapseForeign: (nodeId: string) => void;
}

export type BlockCardNode = Node<BlockCardData, "block">;

export function BlockCard({ data }: NodeProps<BlockCardNode>) {
  const { block, geometry, lines, addedLines, removalAnchors, callLines, status, commentCount, selected } = data;
  const callLineSet = new Set(callLines);
  const classes = ["block-card", status ? `status-${status}` : "", selected ? "is-selected" : "", block.foreign ? "is-foreign" : ""];
  return (
    <div className={classes.join(" ")} style={{ width: CARD_WIDTH, height: geometry.height }}>
      <Handle type="target" position={Position.Left} id="in" style={{ top: HEADER_HEIGHT / 2 }} isConnectable={false} />
      <header className="block-card__header" style={{ height: HEADER_HEIGHT }}>
        <span className="step-badge" title="Reading order">{block.step}</span>
        <span className="kind-icon" aria-hidden="true">{KIND_ICONS[block.symbol.kind]}</span>
        <span className="block-card__title" title={block.symbol.qualifiedName}>
          {block.symbol.kind === "section" ? block.symbol.name : block.symbol.qualifiedName}
        </span>
        {block.foreign && <span className="block-card__file" title={block.symbol.filePath}>{block.symbol.filePath}</span>}
        <StatusPill status={status} />
        {commentCount > 0 && <span className="comment-badge" title="Open comments">💬 {commentCount}</span>}
        {!geometry.truncated && geometry.shownLines > MAX_COLLAPSED_LINES && (
          <button
            className="small-button nodrag"
            title="Show fewer lines"
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleOpen(block.nodeId);
            }}
          >
            Fold
          </button>
        )}
        {block.foreign && (
          <button
            className="icon-button nodrag"
            title="Collapse back to a reference"
            onClick={(event) => {
              event.stopPropagation();
              data.onCollapseForeign(block.nodeId);
            }}
          >
            ✕
          </button>
        )}
      </header>
      <pre className="block-card__code">
        {lines.map((text, index) => {
          const line = block.displayStart + index;
          const lineClasses = [
            "code-line",
            addedLines.has(line) ? "is-added" : "",
            removalAnchors.has(line) ? "has-removal" : "",
            callLineSet.has(line) ? "is-call" : "",
          ];
          return (
            <div key={line} className={lineClasses.join(" ")} style={{ height: LINE_HEIGHT }}>
              <span className="code-line__number">{line}</span>
              <span className="code-line__text">{text === "" ? " " : text}</span>
            </div>
          );
        })}
      </pre>
      {geometry.truncated && (
        <button
          className="block-card__more nodrag"
          style={{ height: FOOTER_HEIGHT }}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleOpen(block.nodeId);
          }}
        >
          Show all {block.displayEnd - block.displayStart + 1} lines
        </button>
      )}
      {callLines.map((line) => (
        <Handle
          key={line}
          type="source"
          position={Position.Right}
          id={`L${line}`}
          isConnectable={false}
          style={{ top: lineOffset(block, geometry.shownLines, geometry.truncated, line) }}
        />
      ))}
    </div>
  );
}
