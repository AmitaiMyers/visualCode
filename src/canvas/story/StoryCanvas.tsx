import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Background, BackgroundVariant, MiniMap, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import { ChevronDown, ChevronUp, Diff, Map as MapIcon, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type { Analysis } from "../../analysis/analyze";
import type { ChangeStatus, Language } from "../../model/types";
import { languageOf } from "../../parse/language";
import { buildChangeStory, buildStory, type ChangeOrder, type Story, type StoryBlock } from "../../graph/story";
import { changeSize, fileLines, removedLinesAbove } from "../../analysis/source";
import { callerCount } from "../../graph/impact";
import { fileId } from "../../model/ids";
import { useShortcuts } from "../../state/useShortcuts";
import { useAnalysis, useDispatch, useNavigation, useNoteCounts, useReview, useWorkspace } from "../../state/workspace";
import { mustGet } from "../../util/assert";
import { IconButton } from "../../ui/Button";
import { kindWord, statusWord } from "../../ui/Badges";
import { BlockCard, type BlockCardNode } from "./BlockCard";
import { FlowEdge, FlowMarkers, type FlowEdgeType, type FlowState } from "./FlowEdge";
import { StubCard, type StubCardNode } from "./StubCard";
import { CARD_WIDTH, STUB_HEIGHT, STUB_WIDTH, cardRows, layoutStory, type CardRow } from "./storyLayout";
import styles from "./StoryCanvas.module.css";

const NODE_TYPES = { block: BlockCard, stub: StubCard };
const EDGE_TYPES = { flow: FlowEdge };
const EMPTY_SET: ReadonlySet<string> = new Set();
const ENTER_STAGGER_MS = 30;
const MAX_STAGGERED_CARDS = 12;
const DRAW_START_MS = 320;
const DRAW_STEP_MS = 45;
const CAMERA_MS = 420;

/** Stories whose arrows already drew themselves this session: the draw-in plays once per story. */
const drawnStories = new Set<string>();

function cameraDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CAMERA_MS;
}

interface Hover {
  nodeId: string;
  line: number | null; // a hovered call line narrows tracing to that one arrow
}

/** The storyline of one file: blocks in reading order, branches to the right, ink arrows from call lines. */
export function FileStoryCanvas({ filePath, reviewEnabled }: { filePath: string; reviewEnabled: boolean }) {
  const analysis = useAnalysis();
  const { expandedByFile } = useWorkspace();
  const dispatch = useDispatch();
  const expanded = expandedByFile.get(filePath) ?? EMPTY_SET;
  const story = useMemo(() => buildStory(analysis.graph, filePath, expanded), [analysis, filePath, expanded]);
  const onExpand = useCallback(
    (nodeId: string) => {
      dispatch({ type: "setExpanded", filePath, nodeId, expanded: true });
      dispatch({ type: "select", nodeId });
    },
    [dispatch, filePath],
  );
  const onCollapse = useCallback((nodeId: string) => dispatch({ type: "setExpanded", filePath, nodeId, expanded: false }), [dispatch, filePath]);
  return (
    <StoryView
      story={story}
      storyKey={`file:${filePath}`}
      reviewEnabled={reviewEnabled}
      onExpand={onExpand}
      onCollapse={onCollapse}
      emptyTitle="There is no code to show"
      emptyText="This file was deleted in this change. Its diff is in the details panel."
    />
  );
}

/** Every changed block of the change set, across files, in the reviewer's chosen order. */
export function ChangesStoryCanvas({ order, reviewEnabled }: { order: ChangeOrder; reviewEnabled: boolean }) {
  const analysis = useAnalysis();
  const story = useMemo(() => buildChangeStory(analysis.graph, analysis.changes, order, (symbol) => changeSize(analysis, symbol)), [analysis, order]);
  return (
    <StoryView
      story={story}
      storyKey={`changes:${order}`}
      reviewEnabled={reviewEnabled}
      onExpand={NO_OP}
      onCollapse={NO_OP}
      emptyTitle="No changed blocks"
      emptyText="This diff changes no code blocks VisualCode can read."
    />
  );
}

const NO_OP = (): void => {};

interface StoryViewProps {
  story: Story;
  storyKey: string; // identifies the story for the once-per-session draw-in
  reviewEnabled: boolean;
  onExpand: (nodeId: string) => void;
  onCollapse: (nodeId: string) => void;
  emptyTitle: string;
  emptyText: string;
}

function StoryView({ story, storyKey, reviewEnabled, onExpand, onCollapse, emptyTitle, emptyText }: StoryViewProps) {
  const analysis = useAnalysis();
  const { selectedId, viewed, showRemoved } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const noteCounts = useNoteCounts();
  const review = useReview();
  const flow = useReactFlow();
  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [hover, setHover] = useState<Hover | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [animate] = useState(() => !drawnStories.has(storyKey));
  const hasDiff = analysis.diffByPath.size > 0;

  useEffect(() => {
    drawnStories.add(storyKey);
  }, [storyKey]);

  const rowsByNode = useMemo(() => {
    const rows = new Map<string, CardRow[]>();
    for (const { item } of story.entries) {
      if (item.type === "block") rows.set(item.nodeId, blockRows(analysis, item, showRemoved));
    }
    return rows;
  }, [analysis, story, showRemoved]);
  const geometry = useMemo(() => layoutStory(story, (nodeId) => mustGet(rowsByNode, nodeId, "Card rows"), openCards), [story, rowsByNode, openCards]);
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
        ...diffMarks(analysis, item, showRemoved),
        rows: mustGet(rowsByNode, item.nodeId, "Card rows"),
        block: item,
        geometry: card,
        language: languageOfBlock(item),
        callLines: callLinesByBlock.get(item.nodeId) ?? [],
        status,
        viewed: viewed.has(item.nodeId),
        reviewable: reviewable.has(item.nodeId),
        noteCount: noteCounts.get(item.nodeId) ?? 0,
        callerCount: status === null ? null : callerCount(analysis.graph, item.nodeId),
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
        <h2>{emptyTitle}</h2>
        <p className="muted">{emptyText}</p>
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
          {hasDiff && (
            <IconButton icon={Diff} label={showRemoved ? "Hide removed lines" : "Show removed lines"} tooltipSide="top" pressed={showRemoved} onClick={() => dispatch({ type: "setShowRemoved", value: !showRemoved })} />
          )}
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

/** A card's rows: its lines from the version it lives in, with removed lines inline when the reader wants them. */
function blockRows(analysis: Analysis, block: StoryBlock, showRemoved: boolean): CardRow[] {
  const { symbol } = block;
  const lines = fileLines(analysis, symbol.filePath, symbol.origin).slice(block.displayStart - 1, block.displayEnd);
  const removedAbove = showRemoved && symbol.origin === "current" ? removedLinesAbove(analysis, symbol.filePath) : () => [];
  return cardRows(block.displayStart, lines, removedAbove);
}

/** Added-line washes and, when removed lines are hidden, the markers where lines were removed. Removed blocks have neither. */
function diffMarks(analysis: Analysis, block: StoryBlock, showRemoved: boolean) {
  const diff = analysis.diffByPath.get(block.symbol.filePath);
  if (diff === undefined || block.symbol.origin === "removed") return { addedLines: EMPTY_LINES, removalAnchors: EMPTY_LINES };
  return {
    addedLines: new Set(diff.addedLines),
    removalAnchors: showRemoved ? EMPTY_LINES : new Set(diff.removalAnchors),
  };
}

const EMPTY_LINES: ReadonlySet<number> = new Set();
