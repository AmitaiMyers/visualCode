import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ChangeStatus } from "../../model/types";
import type { StoryStub } from "../../graph/story";
import { KindGlyph, StatusBadge } from "../../ui/Badges";
import { Button } from "../../ui/Button";
import { STUB_HEIGHT, STUB_WIDTH } from "./storyLayout";
import styles from "./StoryCanvas.module.css";

export interface StubCardData extends Record<string, unknown> {
  stub: StoryStub;
  status: ChangeStatus | null;
  selected: boolean;
  traceState: "rest" | "traced" | "dimmed";
  enterDelayMs: number | null;
  onExpand: (nodeId: string) => void;
  onOpenFile: (filePath: string) => void;
}

export type StubCardNode = Node<StubCardData, "stub">;

/** A collapsed reference to code in another file: Expand pulls it into the story, Open jumps to its file. */
export const StubCard = memo(function StubCard({ data }: NodeProps<StubCardNode>) {
  const { stub, status, selected } = data;
  const { node } = stub;
  const classes = [styles.stub, selected ? styles.cardSelected : "", styles[`trace-${data.traceState}`], data.enterDelayMs === null ? "" : styles.entering];
  return (
    <div
      className={classes.join(" ")}
      style={{ width: STUB_WIDTH, height: STUB_HEIGHT, animationDelay: data.enterDelayMs === null ? undefined : `${data.enterDelayMs}ms` }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ top: STUB_HEIGHT / 2 }} isConnectable={false} />
      <KindGlyph kind={node.symbol === null ? "file" : node.symbol.kind} />
      <span className={styles.stubText}>
        <span className={styles.stubName}>{node.symbol === null ? node.label : node.symbol.qualifiedName}</span>
        <span className={styles.stubPath}>{node.path}</span>
      </span>
      {status !== null && <StatusBadge status={status} />}
      {stub.expandable && (
        <Button
          size="sm"
          className="nodrag"
          onClick={(event) => {
            event.stopPropagation();
            data.onExpand(node.id);
          }}
        >
          Expand
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="nodrag"
        onClick={(event) => {
          event.stopPropagation();
          data.onOpenFile(node.path);
        }}
      >
        Open
      </Button>
    </div>
  );
});
