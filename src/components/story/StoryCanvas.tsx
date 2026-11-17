import { useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import type { Analysis } from "../../analysis/analyze";
import { buildStory, type StoryBlock, type StoryStub } from "../../graph/story";
import { mustGet } from "../../util/assert";
import { BlockCard, type BlockCardNode } from "./BlockCard";
import { StubCard, type StubCardNode } from "./StubCard";
import { CARD_WIDTH, STUB_HEIGHT, STUB_WIDTH, layoutStory, type CardGeometry } from "./storyLayout";

const NODE_TYPES = { block: BlockCard, stub: StubCard };
const EMPTY_LINES: ReadonlySet<number> = new Set();

interface StoryCanvasProps {
  analysis: Analysis;
  filePath: string;
  expandedNodeIds: ReadonlySet<string>;
  selectedId: string | null;
  commentCounts: Map<string, number>;
  onSelect: (nodeId: string) => void;
  onExpand: (nodeId: string) => void;
  onCollapse: (nodeId: string) => void;
  onOpenFile: (filePath: string) => void;
}

/** The storyline of one file: code blocks ordered by flow, arrows from each call line to its callee. */
export function StoryCanvas(props: StoryCanvasProps) {
  const { analysis, filePath, expandedNodeIds, selectedId, commentCounts } = props;
  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(new Set());

  const story = useMemo(() => buildStory(analysis.graph, filePath, expandedNodeIds), [analysis, filePath, expandedNodeIds]);
  const geometry = useMemo(() => layoutStory(story, openCards), [story, openCards]);

  const toggleOpen = (nodeId: string): void => {
    setOpenCards((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const callLinesByBlock = new Map<string, number[]>();
  for (const call of story.calls) {
    const lines = callLinesByBlock.get(call.fromNodeId) ?? [];
    if (!lines.includes(call.line)) lines.push(call.line);
    callLinesByBlock.set(call.fromNodeId, lines);
  }

  const nodes: (BlockCardNode | StubCardNode)[] = story.entries.map(({ item }) => {
    const cardGeometry = mustGet(geometry, item.nodeId, "Card geometry");
    const position = { x: cardGeometry.x, y: cardGeometry.y };
    const status = statusOf(analysis, item.nodeId);
    const selected = item.nodeId === selectedId;
    if (item.type === "stub") {
      return {
        id: item.nodeId,
        type: "stub",
        position,
        width: STUB_WIDTH,
        height: STUB_HEIGHT,
        data: stubData(item, status, selected, props),
      };
    }
    return {
      id: item.nodeId,
      type: "block",
      position,
      // Known sizes: React Flow would otherwise hide re-created nodes for a frame while re-measuring.
      width: CARD_WIDTH,
      height: cardGeometry.height,
      data: {
        ...blockSource(analysis, item, cardGeometry),
        block: item,
        geometry: cardGeometry,
        callLines: callLinesByBlock.get(item.nodeId) ?? [],
        status,
        commentCount: commentCounts.get(item.nodeId) ?? 0,
        selected,
        onToggleOpen: toggleOpen,
        onCollapseForeign: props.onCollapse,
      },
    };
  });

  const edges: Edge[] = story.calls.map((call) => {
    const highlighted = selectedId !== null && (call.fromNodeId === selectedId || call.toNodeId === selectedId);
    return {
      id: call.id,
      source: call.fromNodeId,
      sourceHandle: `L${call.line}`,
      target: call.toNodeId,
      targetHandle: "in",
      type: "default",
      className: highlighted ? "story-edge is-highlighted" : "story-edge",
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    };
  });

  if (story.entries.length === 0) {
    return <div className="canvas-empty">This file has no code to show (it may have been deleted in this change).</div>;
  }

  return (
    <ReactFlow
      key={filePath}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, node) => props.onSelect(node.id)}
      zoomOnDoubleClick={false}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ maxZoom: 1, padding: 0.08, nodes: nodes.slice(0, 4).map((node) => ({ id: node.id })) }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function statusOf(analysis: Analysis, nodeId: string) {
  const change = analysis.changes.get(nodeId);
  return change === undefined ? null : change.status;
}

function stubData(stub: StoryStub, status: ReturnType<typeof statusOf>, selected: boolean, props: StoryCanvasProps) {
  return { stub, status, selected, onExpand: props.onExpand, onOpenFile: props.onOpenFile };
}

const splitCache = new WeakMap<Analysis, Map<string, string[]>>();

/** Source lines of a file, split once per analysis. */
function fileLines(analysis: Analysis, path: string): string[] {
  let byPath = splitCache.get(analysis);
  if (byPath === undefined) {
    byPath = new Map();
    splitCache.set(analysis, byPath);
  }
  const cached = byPath.get(path);
  if (cached !== undefined) return cached;
  const lines = mustGet(analysis.contents, path, "File content").split("\n");
  byPath.set(path, lines);
  return lines;
}

function blockSource(analysis: Analysis, block: StoryBlock, cardGeometry: CardGeometry) {
  const lines = fileLines(analysis, block.symbol.filePath).slice(block.displayStart - 1, block.displayStart - 1 + cardGeometry.shownLines);
  const diff = analysis.diffByPath.get(block.symbol.filePath);
  return {
    lines,
    addedLines: diff === undefined ? EMPTY_LINES : new Set(diff.addedLines),
    removalAnchors: diff === undefined ? EMPTY_LINES : new Set(diff.removalAnchors),
  };
}
