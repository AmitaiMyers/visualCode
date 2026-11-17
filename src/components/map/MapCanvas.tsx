import { useMemo, useRef } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { Analysis } from "../../analysis/analyze";
import type { CodeNode } from "../../model/types";
import type { ChangeInfo } from "../../graph/changes";
import { computeView } from "../../graph/view";
import { NODE_HEIGHT, NODE_WIDTH, layoutView } from "../../graph/layout";
import { mustGet } from "../../util/assert";
import { KIND_ICONS, StatusPill } from "../common";

interface MapNodeData extends Record<string, unknown> {
  node: CodeNode;
  ghost: boolean;
  change: ChangeInfo | null;
  commentCount: number;
  selected: boolean;
}

type MapNode = Node<MapNodeData, "map">;

const NODE_TYPES = { map: MapNodeCard };
const DOUBLE_CLICK_MS = 400;

interface MapCanvasProps {
  analysis: Analysis;
  scopeId: string;
  changedOnly: boolean;
  selectedId: string | null;
  commentCounts: Map<string, number>;
  onSelect: (nodeId: string) => void;
  onOpen: (nodeId: string) => void;
}

/** Folder-level map: the scope's folders and files, with imports/calls lifted to them. */
export function MapCanvas(props: MapCanvasProps) {
  const { analysis, scopeId, changedOnly, selectedId, commentCounts } = props;
  const view = useMemo(
    () => computeView(analysis.graph, scopeId, (id) => !changedOnly || analysis.changes.has(id)),
    [analysis, scopeId, changedOnly],
  );
  const positions = useMemo(() => layoutView(view), [view]);
  const lastClick = useRef<{ nodeId: string; time: number } | null>(null);

  /**
   * Single click selects; a second click on the same node within DOUBLE_CLICK_MS opens it.
   * Detected here because React Flow's native dblclick does not reliably reach React
   * when the first click changes the selection. Also gives double-tap on touch screens.
   */
  const handleClick = (nodeId: string): void => {
    const now = performance.now();
    const previous = lastClick.current;
    if (previous !== null && previous.nodeId === nodeId && now - previous.time < DOUBLE_CLICK_MS) {
      lastClick.current = null;
      props.onOpen(nodeId);
      return;
    }
    lastClick.current = { nodeId, time: now };
    props.onSelect(nodeId);
  };

  const nodes: MapNode[] = view.nodes.map(({ node, ghost }) => {
    const change = analysis.changes.get(node.id);
    return {
      id: node.id,
      type: "map",
      position: mustGet(positions, node.id, "Map position"),
      // Known sizes: React Flow would otherwise hide re-created nodes for a frame while re-measuring.
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        node,
        ghost,
        change: change === undefined ? null : change,
        commentCount: commentCounts.get(node.id) ?? 0,
        selected: node.id === selectedId,
      },
    };
  });

  const edges: Edge[] = view.edges.map((edge) => {
    const highlighted = selectedId !== null && (edge.source === selectedId || edge.target === selectedId);
    const classes = ["map-edge", edge.kinds.includes("call") ? "has-calls" : "imports-only", highlighted ? "is-highlighted" : ""];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.count > 1 ? String(edge.count) : undefined,
      className: classes.join(" "),
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    };
  });

  if (nodes.length === 0) {
    return <div className="canvas-empty">{changedOnly ? "Nothing changed in this folder." : "This folder is empty."}</div>;
  }

  return (
    <ReactFlow
      key={`${scopeId}|${changedOnly}`}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, node) => handleClick(node.id)}
      zoomOnDoubleClick={false}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ maxZoom: 1.1, padding: 0.15 }}
      minZoom={0.05}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function MapNodeCard({ data }: NodeProps<MapNode>) {
  const { node, ghost, change, commentCount, selected } = data;
  const status = change === null ? null : change.status;
  const containsChanges = change !== null && change.status === null && change.changedDescendants > 0;
  const classes = [
    "map-node",
    `map-node--${node.kind}`,
    ghost ? "is-ghost" : "",
    status ? `status-${status}` : "",
    containsChanges ? "has-changes" : "",
    selected ? "is-selected" : "",
  ];
  return (
    <div className={classes.join(" ")} style={{ width: NODE_WIDTH, height: NODE_HEIGHT }} title={ghost ? `Outside this folder: ${node.path}` : node.path}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="map-node__title">
        <span aria-hidden="true">{KIND_ICONS[node.kind]}</span>
        <span className="map-node__label">{node.label}</span>
      </div>
      <div className="map-node__meta">
        <span>{subtitle(node, ghost)}</span>
        <StatusPill status={status} />
        {change !== null && change.changedDescendants > 0 && (
          <span className="change-count" title={node.kind === "folder" ? "Changed files inside" : "Changed blocks"}>
            Δ {change.changedDescendants}
          </span>
        )}
        {commentCount > 0 && <span className="comment-badge">💬 {commentCount}</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function subtitle(node: CodeNode, ghost: boolean): string {
  if (ghost) return "outside";
  if (node.kind === "folder") return `${node.childIds.length} items`;
  return `${node.childIds.length} blocks`;
}
