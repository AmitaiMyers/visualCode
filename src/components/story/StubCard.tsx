import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ChangeStatus } from "../../model/types";
import type { StoryStub } from "../../graph/story";
import { STUB_HEIGHT, STUB_WIDTH } from "./storyLayout";
import { KIND_ICONS, StatusPill } from "../common";

export interface StubCardData extends Record<string, unknown> {
  stub: StoryStub;
  status: ChangeStatus | null;
  selected: boolean;
  onExpand: (nodeId: string) => void;
  onOpenFile: (filePath: string) => void;
}

export type StubCardNode = Node<StubCardData, "stub">;

/** A collapsed reference to code in another file. */
export function StubCard({ data }: NodeProps<StubCardNode>) {
  const { stub, status, selected } = data;
  const { node } = stub;
  const icon = node.symbol === null ? KIND_ICONS.file : KIND_ICONS[node.symbol.kind];
  const name = node.symbol === null ? node.label : node.symbol.qualifiedName;
  return (
    <div
      className={["stub-card", status ? `status-${status}` : "", selected ? "is-selected" : ""].join(" ")}
      style={{ width: STUB_WIDTH, height: STUB_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ top: STUB_HEIGHT / 2 }} isConnectable={false} />
      <div className="stub-card__text">
        <span className="stub-card__name">
          <span aria-hidden="true">{icon}</span> {name}
        </span>
        <span className="stub-card__file" title={node.path}>{node.path}</span>
      </div>
      <StatusPill status={status} />
      <div className="stub-card__actions">
        {stub.expandable && (
          <button
            className="small-button nodrag"
            title="Pull this block's code into the story"
            onClick={(event) => {
              event.stopPropagation();
              data.onExpand(node.id);
            }}
          >
            Expand
          </button>
        )}
        <button
          className="small-button nodrag"
          title="Open this file's storyline"
          onClick={(event) => {
            event.stopPropagation();
            data.onOpenFile(node.path);
          }}
        >
          Open
        </button>
      </div>
    </div>
  );
}
