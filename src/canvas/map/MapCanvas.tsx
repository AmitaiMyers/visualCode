import { memo, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Background, BackgroundVariant, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { FileCode2, Folder, Map as MapIcon, Maximize, MessageSquare, ZoomIn, ZoomOut } from "lucide-react";
import type { CodeNode } from "../../model/types";
import type { ChangeInfo } from "../../graph/changes";
import { NODE_HEIGHT, NODE_WIDTH, layoutView } from "../../graph/layout";
import { computeView } from "../../graph/view";
import { useShortcuts } from "../../state/useShortcuts";
import { useAnalysis, useDispatch, useNavigation, useNoteCounts, useWorkspace } from "../../state/workspace";
import { mustGet } from "../../util/assert";
import { ChangeCount, StatusBadge } from "../../ui/Badges";
import { IconButton } from "../../ui/Button";
import styles from "./MapCanvas.module.css";

interface MapNodeData extends Record<string, unknown> {
  node: CodeNode;
  ghost: boolean;
  change: ChangeInfo | null;
  noteCount: number;
  selected: boolean;
}

type MapNode = Node<MapNodeData, "map">;

const DOUBLE_CLICK_MS = 400;

/** Folder-level map: the scope's folders and files with imports and calls lifted between them. */
export function MapCanvas({ scopeId }: { scopeId: string }) {
  const analysis = useAnalysis();
  const { selectedId, changedOnly } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const noteCounts = useNoteCounts();
  const flow = useReactFlow();
  const [showMinimap, setShowMinimap] = useState(false);
  const lastClick = useRef<{ nodeId: string; time: number } | null>(null);

  const view = useMemo(
    () => computeView(analysis.graph, scopeId, (id) => !changedOnly || analysis.changes.has(id)),
    [analysis, scopeId, changedOnly],
  );
  const positions = useMemo(() => layoutView(view), [view]);

  /**
   * Click selects; a second click on the same node within DOUBLE_CLICK_MS opens it (also gives
   * double-tap on touch). Detected here because React Flow's native dblclick can be swallowed.
   */
  const handleClick = (nodeId: string): void => {
    const now = performance.now();
    const previous = lastClick.current;
    if (previous !== null && previous.nodeId === nodeId && now - previous.time < DOUBLE_CLICK_MS) {
      lastClick.current = null;
      navigation.open(nodeId);
      return;
    }
    lastClick.current = { nodeId, time: now };
    dispatch({ type: "select", nodeId });
  };

  const fit = (): void => {
    void flow.fitView({ duration: 300, padding: 0.15, maxZoom: 1.1 });
  };
  useShortcuts({ f: fit });

  const nodes: MapNode[] = view.nodes.map(({ node, ghost }) => {
    const change = analysis.changes.get(node.id);
    return {
      id: node.id,
      type: "map",
      position: mustGet(positions, node.id, "Map position"),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      ariaLabel: `${node.kind} ${node.label}${ghost ? ", outside this folder" : ""}. Press Enter to open.`,
      data: { node, ghost, change: change === undefined ? null : change, noteCount: noteCounts.get(node.id) ?? 0, selected: node.id === selectedId },
    };
  });

  const edges: Edge[] = view.edges.map((edge) => {
    const highlighted = selectedId !== null && (edge.source === selectedId || edge.target === selectedId);
    const callsIncluded = edge.kinds.includes("call");
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.count > 1 ? String(edge.count) : undefined,
      focusable: false,
      zIndex: highlighted ? 1 : 0,
      className: [styles.edge, callsIncluded ? "" : styles.importsOnly, highlighted ? styles.edgeHighlighted : ""].join(" "),
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: highlighted ? "var(--ink)" : "var(--line-strong)" },
    };
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter") return;
    const nodeId = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.dataset["id"];
    if (nodeId === undefined) return;
    event.preventDefault();
    navigation.open(nodeId);
  };

  if (nodes.length === 0) {
    return (
      <div className={styles.empty}>
        <h2>{changedOnly ? "Nothing changed in this folder" : "This folder is empty"}</h2>
        {changedOnly && <p className="muted">Turn off “Changed only” to see every file.</p>}
      </div>
    );
  }

  return (
    <div className={styles.canvas} onKeyDown={onKeyDown}>
      <ReactFlow
        key={`${scopeId}|${changedOnly}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => handleClick(node.id)}
        onPaneClick={() => dispatch({ type: "select", nodeId: null })}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ maxZoom: 1.1, padding: 0.15 }}
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
        {showMinimap && <MiniMap pannable zoomable position="bottom-left" nodeStrokeWidth={0} />}
        <Panel position="bottom-right" className={styles.toolbar}>
          <IconButton icon={ZoomOut} label="Zoom out" tooltipSide="top" onClick={() => void flow.zoomOut({ duration: 160 })} />
          <IconButton icon={ZoomIn} label="Zoom in" tooltipSide="top" onClick={() => void flow.zoomIn({ duration: 160 })} />
          <IconButton icon={Maximize} label="Fit to content" shortcut="F" tooltipSide="top" onClick={fit} />
          <IconButton icon={MapIcon} label="Minimap" tooltipSide="top" pressed={showMinimap} onClick={() => setShowMinimap((show) => !show)} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

const MapNodeCard = memo(function MapNodeCard({ data }: NodeProps<MapNode>) {
  const { node, ghost, change, noteCount, selected } = data;
  const status = change === null ? null : change.status;
  const containsChanges = change !== null && change.status === null && change.changedDescendants > 0;
  const classes = [
    styles.node,
    node.kind === "folder" ? styles.folder : "",
    ghost ? styles.ghost : "",
    containsChanges || status !== null ? styles.changed : "",
    selected ? styles.selected : "",
  ];
  const Icon = node.kind === "folder" ? Folder : FileCode2;
  return (
    <div className={classes.join(" ")} style={{ width: NODE_WIDTH, height: NODE_HEIGHT }} title={ghost ? `Outside this folder: ${node.path}` : node.path}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className={styles.title}>
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.label}>{node.label}</span>
      </div>
      <div className={styles.meta}>
        <span>{ghost ? "outside this folder" : subtitle(node)}</span>
        {status !== null && <StatusBadge status={status} />}
        {containsChanges && <ChangeCount count={change.changedDescendants} />}
        {noteCount > 0 && (
          <span className={styles.notes} aria-label={`${noteCount} open notes`}>
            <MessageSquare size={12} aria-hidden="true" />
            {noteCount}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

const NODE_TYPES = { map: MapNodeCard };

function subtitle(node: CodeNode): string {
  const count = node.childIds.length;
  if (node.kind === "folder") return `${count} ${count === 1 ? "item" : "items"}`;
  return `${count} ${count === 1 ? "block" : "blocks"}`;
}
