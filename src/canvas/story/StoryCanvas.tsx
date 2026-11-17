import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Background, BackgroundVariant, MiniMap, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import { ChevronDown, ChevronUp, Map as MapIcon, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type { Analysis } from "../../analysis/analyze";
import type { ChangeStatus, Language } from "../../model/types";
import { languageOf } from "../../parse/language";
import { buildStory, type StoryBlock } from "../../graph/story";
import { fileId } from "../../model/ids";
import { useShortcuts } from "../../state/useShortcuts";
import { useAnalysis, useDispatch, useNavigation, useNoteCounts, useReview, useWorkspace } from "../../state/workspace";
import { mustGet } from "../../util/assert";
import { IconButton } from "../../ui/Button";
import { kindWord, statusWord } from "../../ui/Badges";
import { BlockCard, type BlockCardNode } from "./BlockCard";
import { FlowEdge, FlowMarkers, type FlowEdgeType, type FlowState } from "./FlowEdge";
import { StubCard, type StubCardNode } from "./StubCard";
import { CARD_WIDTH, STUB_HEIGHT, STUB_WIDTH, layoutStory, type CardGeometry } from "./storyLayout";
import styles from "./StoryCanvas.module.css";

const NODE_TYPES = { block: BlockCard, stub: StubCard };
const EDGE_TYPES = { flow: FlowEdge };
const EMPTY_SET: ReadonlySet<string> = new Set();
const ENTER_STAGGER_MS = 30;
const MAX_STAGGERED_CARDS = 12;
const DRAW_START_MS = 320;
const DRAW_STEP_MS = 45;
const CAMERA_MS = 420;

/** Files whose arrows already drew themselves this session: the draw-in plays once per file. */
const drawnFiles = new Set<string>();

function cameraDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CAMERA_MS;
}

interface Hover {
  nodeId: string;
  line: number | null; // a hovered call line narrows tracing to that one arrow
}

/** The storyline of one file: blocks in reading order, branches to the right, ink arrows from call lines. */
export function StoryCanvas({ filePath, reviewEnabled }: { filePath: string; reviewEnabled: boolean }) {
  const analysis = useAnalysis();
  const { selectedId, expandedByFile, viewed } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const noteCounts = useNoteCounts();
  const review = useReview();
  const flow = useReactFlow();
  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [hover, setHover] = useState<Hover | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [animate] = useState(() => !drawnFiles.has(filePath));

  useEffect(() => {
    drawnFiles.add(filePath);
  }, [filePath]);

  const expanded = expandedByFile.get(filePath) ?? EMPTY_SET;
  const story = useMemo(() => buildStory(analysis.graph, filePath, expanded), [analysis, filePath, expanded]);
  const geometry = useMemo(() => layoutStory(story, openCards), [story, openCards]);
  const blocks = useMemo(() => story.entries.flatMap(({ item }) => (item.type === "block" ? [item] : [])), [story]);
  const reviewable = useMemo(() => new Set(reviewEnabled && review !== null ? review.items.map((item) => item.nodeId) : []), [reviewEnabled, review]);

  // ----- camera -----

  const centerOn = useCallback(
    (nodeId: string) => {
      const card = geometry.get(nodeId);
      if (card === undefined) return;
      const width = story.entries.find((entry) => entry.item.nodeId === nodeId)?.item.type === "stub" ? STUB_WIDTH : CARD_WIDTH;
      flow.setCenter(card.x + width / 2, card.y + Math.min(card.height / 2, 220), { zoom: Math.max(flow.getZoom(), 0.85), duration: cameraDuration() });
    },
    [flow, geometry, story],
  );

  // Glide to the selected card whenever the selection changes (J/K, review list, search, arrows).
  useEffect(() => {
    if (selectedId !== null && geometry.has(selectedId)) centerOn(selectedId);
    // Only selection changes move the camera; layout changes (expanding a card) must not.
  }, [selectedId]);

  const select = (nodeId: string): void => dispatch({ type: "select", nodeId });

  const stepBy = (delta: 1 | -1): void => {
    if (blocks.length === 0) return;
    const index = blocks.findIndex((block) => block.nodeId === selectedId);
    const next = index === -1 ? (delta === 1 ? 0 : blocks.length - 1) : Math.max(0, Math.min(blocks.length - 1, index + delta));
    const block = blocks[next];
    if (block !== undefined) select(block.nodeId);
  };

  const fit = (): void => {
    void flow.fitView({ duration: cameraDuration(), padding: 0.08 });
  };

  useShortcuts({ j: () => stepBy(1), k: () => stepBy(-1), f: fit });

  // ----- interactions -----

  const callTargets = useMemo(() => {
    const byLine = new Map<string, string[]>();
    for (const call of story.calls) {
      const key = `${call.fromNodeId}:${call.line}`;
      byLine.set(key, [...(byLine.get(key) ?? []), call.toNodeId]);
    }
    return byLine;
  }, [story]);

  const onLineHover = useCallback((nodeId: string, line: number | null) => setHover(line === null ? { nodeId, line: null } : { nodeId, line }), []);
  const onFollowLine = useCallback(
    (nodeId: string, line: number) => {
      const [target] = callTargets.get(`${nodeId}:${line}`) ?? [];
      if (target !== undefined) dispatch({ type: "select", nodeId: target });
    },
    [callTargets, dispatch],
  );
  const onToggleOpen = useCallback(
    (nodeId: string) =>
      setOpenCards((current) => {
        const next = new Set(current);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      }),
    [],
  );
  const onToggleViewed = useCallback((nodeId: string) => dispatch({ type: "setViewed", nodeId, viewed: !viewed.has(nodeId) }), [dispatch, viewed]);
  const onExpand = useCallback((nodeId: string) => {
    dispatch({ type: "setExpanded", filePath, nodeId, expanded: true });
    dispatch({ type: "select", nodeId });
  }, [dispatch, filePath]);
  const onCollapse = useCallback((nodeId: string) => dispatch({ type: "setExpanded", filePath, nodeId, expanded: false }), [dispatch, filePath]);
  const onOpenFile = useCallback((path: string) => navigation.open(fileId(path)), [navigation]);

  // ----- tracing: which arrows and cards light up -----

  const traceFocus = hover?.nodeId ?? null;
  const tracedEdge = (fromNodeId: string, line: number, toNodeId: string): FlowState => {
    if (hover !== null && hover.line !== null) return fromNodeId === hover.nodeId && line === hover.line ? "traced" : "dimmed";
    if (traceFocus !== null) return fromNodeId === traceFocus || toNodeId === traceFocus ? "traced" : "dimmed";
    if (selectedId !== null && (fromNodeId === selectedId || toNodeId === selectedId)) return "traced";
    return "rest";
  };
  const connectedToFocus = useMemo(() => {
    const ids = new Set<string>();
    if (traceFocus === null) return ids;
    ids.add(traceFocus);
    for (const call of story.calls) {
      if (hover !== null && hover.line !== null && !(call.fromNodeId === hover.nodeId && call.line === hover.line)) continue;
      if (call.fromNodeId === traceFocus || call.toNodeId === traceFocus) {
        ids.add(call.fromNodeId);
        ids.add(call.toNodeId);
      }
    }
    return ids;
  }, [traceFocus, hover, story]);
  const cardTrace = (nodeId: string): FlowState => (traceFocus === null ? "rest" : connectedToFocus.has(nodeId) ? "traced" : "dimmed");

  // ----- React Flow nodes and edges -----

  const callLinesByBlock = new Map<string, number[]>();
  for (const call of story.calls) {
    const lines = callLinesByBlock.get(call.fromNodeId) ?? [];
    if (!lines.includes(call.line)) lines.push(call.line);
    callLinesByBlock.set(call.fromNodeId, lines);
  }
  const stepOf = new Map(blocks.map((block) => [block.nodeId, block.step]));

  const nodes: (BlockCardNode | StubCardNode)[] = story.entries.map(({ item }, index) => {
    const card = mustGet(geometry, item.nodeId, "Card geometry");
    const change = analysis.changes.get(item.nodeId);
    const status = change === undefined ? null : change.status;
    const enterDelayMs = animate && index < MAX_STAGGERED_CARDS ? index * ENTER_STAGGER_MS : null;
    if (item.type === "stub") {
      return {
        id: item.nodeId,
        type: "stub",
        position: { x: card.x, y: card.y },
        width: STUB_WIDTH,
        height: STUB_HEIGHT,
        ariaLabel: `Reference to ${item.node.label} in ${item.node.path}. Enter expands it.`,
        data: { stub: item, status, selected: item.nodeId === selectedId, traceState: cardTrace(item.nodeId), enterDelayMs, onExpand, onOpenFile },
      };
    }
    return {
      id: item.nodeId,
      type: "block",
      position: { x: card.x, y: card.y },
      width: CARD_WIDTH,
      height: card.height,
      ariaLabel: blockLabel(item, blocks.length, status, noteCounts.get(item.nodeId) ?? 0, viewed.has(item.nodeId)),
      data: {
        ...blockSource(analysis, item, card),
        block: item,
        geometry: card,
        language: languageOfBlock(item),
        callLines: callLinesByBlock.get(item.nodeId) ?? [],
        status,
        viewed: viewed.has(item.nodeId),
        reviewable: reviewable.has(item.nodeId),
        noteCount: noteCounts.get(item.nodeId) ?? 0,
        selected: item.nodeId === selectedId,
        traceState: cardTrace(item.nodeId),
        hoveredLine: hover !== null && hover.nodeId === item.nodeId ? hover.line : null,
        enterDelayMs,
        onToggleOpen,
        onCollapseForeign: onCollapse,
        onToggleViewed,
        onLineHover,
        onFollowLine,
      },
    };
  });

  const edges: FlowEdgeType[] = story.calls.map((call) => {
    const step = stepOf.get(call.fromNodeId) ?? 0;
    return {
      id: call.id,
      type: "flow",
      source: call.fromNodeId,
      sourceHandle: `L${call.line}`,
      target: call.toNodeId,
      targetHandle: "in",
      focusable: false,
      zIndex: tracedEdge(call.fromNodeId, call.line, call.toNodeId) === "traced" ? 1 : 0,
      data: { state: tracedEdge(call.fromNodeId, call.line, call.toNodeId), drawDelayMs: animate ? DRAW_START_MS + step * DRAW_STEP_MS : null },
    };
  });

  const selectedIndex = blocks.findIndex((block) => block.nodeId === selectedId);
  const selectedBlock = blocks[selectedIndex];
  const announcement = selectedBlock === undefined ? "" : `Step ${selectedBlock.step} of ${blocks.length}: ${selectedBlock.symbol.qualifiedName}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter") return;
    const nodeElement = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const nodeId = nodeElement?.dataset["id"];
    if (nodeId === undefined) return;
    event.preventDefault();
    const entry = story.entries.find((candidate) => candidate.item.nodeId === nodeId);
    if (entry !== undefined && entry.item.type === "stub" && entry.item.expandable) onExpand(nodeId);
    else select(nodeId);
  };

  if (story.entries.length === 0) {
    return (
      <div className={styles.empty}>
        <h2>There is no code to show</h2>
        <p className="muted">This file was deleted in this change. Its diff is in the details panel.</p>
      </div>
    );
  }

  return (
    <div className={styles.canvas} onKeyDown={onKeyDown}>
      <FlowMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeClick={(_, node) => select(node.id)}
        onNodeMouseEnter={(_, node) => setHover({ nodeId: node.id, line: null })}
        onNodeMouseLeave={() => setHover(null)}
        onPaneClick={() => dispatch({ type: "select", nodeId: null })}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.08}
        maxZoom={1.6}
        onInit={(instance) => {
          if (selectedId !== null && geometry.has(selectedId)) {
            centerOn(selectedId);
            return;
          }
          void instance.fitView({ nodes: nodes.slice(0, 4).map((node) => ({ id: node.id })), maxZoom: 1, padding: 0.12 });
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
        {showMinimap && <MiniMap pannable zoomable position="bottom-left" nodeStrokeWidth={0} />}
        <Panel position="bottom-right" className={styles.toolbar}>
          <span className={styles.stepNav}>
            <IconButton icon={ChevronUp} label="Previous step" shortcut="K" tooltipSide="top" onClick={() => stepBy(-1)} />
            <span className={styles.stepText}>{selectedBlock === undefined ? `${blocks.length} steps` : `Step ${selectedBlock.step} of ${blocks.length}`}</span>
            <IconButton icon={ChevronDown} label="Next step" shortcut="J" tooltipSide="top" onClick={() => stepBy(1)} />
          </span>
          <span className={styles.toolbarDivider} />
          <IconButton icon={ZoomOut} label="Zoom out" tooltipSide="top" onClick={() => void flow.zoomOut({ duration: 160 })} />
          <IconButton icon={ZoomIn} label="Zoom in" tooltipSide="top" onClick={() => void flow.zoomIn({ duration: 160 })} />
          <IconButton icon={Maximize} label="Fit to content" shortcut="F" tooltipSide="top" onClick={fit} />
          <IconButton icon={MapIcon} label="Minimap" tooltipSide="top" pressed={showMinimap} onClick={() => setShowMinimap((show) => !show)} />
        </Panel>
      </ReactFlow>
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

function languageOfBlock(block: StoryBlock): Language {
  const language = languageOf(block.symbol.filePath);
  if (language === null) throw new Error(`Block from an unsupported file: ${block.symbol.filePath}`);
  return language;
}

function blockLabel(block: StoryBlock, total: number, status: ChangeStatus | null, notes: number, viewed: boolean): string {
  const name = block.symbol.kind === "section" ? block.symbol.name : block.symbol.qualifiedName;
  const parts = [`Step ${block.step} of ${total}`, `${kindWord(block.symbol.kind)} ${name}`];
  if (block.foreign) parts.push(`from ${block.symbol.filePath}`);
  if (status !== null) parts.push(viewed ? "viewed" : statusWord(status));
  if (notes > 0) parts.push(`${notes} ${notes === 1 ? "note" : "notes"}`);
  return parts.join(", ");
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

function blockSource(analysis: Analysis, block: StoryBlock, card: CardGeometry) {
  const lines = fileLines(analysis, block.symbol.filePath).slice(block.displayStart - 1, block.displayStart - 1 + card.shownLines);
  const diff = analysis.diffByPath.get(block.symbol.filePath);
  return {
    lines,
    addedLines: diff === undefined ? EMPTY_LINES : new Set(diff.addedLines),
    removalAnchors: diff === undefined ? EMPTY_LINES : new Set(diff.removalAnchors),
  };
}

const EMPTY_LINES: ReadonlySet<number> = new Set();
