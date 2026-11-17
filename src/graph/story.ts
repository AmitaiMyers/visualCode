import type { CodeEdge, CodeGraph, CodeNode, CodeSymbol } from "../model/types";
import type { ChangeIndex } from "./changes";
import { isTestPath } from "./tests";
import { mustGet } from "../util/assert";

/** A code block shown with its source in the storyline. */
export interface StoryBlock {
  type: "block";
  nodeId: string;
  symbol: CodeSymbol;
  displayStart: number; // first source line shown on the card
  displayEnd: number; // last source line shown on the card
  foreign: boolean; // pulled in from another file by expanding a stub
  showPath: boolean; // the card names its file (cross-file stories)
  step: number; // 1-based position in the reading order
}

/** A collapsed reference to code in another file. */
export interface StoryStub {
  type: "stub";
  nodeId: string; // symbol or file node in another file
  node: CodeNode;
  expandable: boolean; // symbols can be pulled into the story; whole files cannot
}

export type StoryItem = StoryBlock | StoryStub;

/** One call arrow: from a line in a block to another block or stub. */
export interface StoryCall {
  id: string;
  fromNodeId: string;
  line: number;
  toNodeId: string;
}

/** Placement hint for the layout: the call that first led the reader to this item. */
export interface StoryEntry {
  item: StoryItem;
  depth: number; // 0 = story column, 1+ = branches to the right
  anchor: { parentNodeId: string; line: number } | null;
}

export interface Story {
  entries: StoryEntry[]; // reading order
  calls: StoryCall[];
}

/** How the cross-file Changes story is ordered. */
export type ChangeOrder = "flow" | "foundations" | "tests" | "largest";

const ENTRY_PRIORITY = { imports: 0, types: 1, constants: 2, entry: 3, runs: 4, declaration: 5, removed: 6 } as const;

/**
 * Orders a file's blocks as a storyline: start at entry points (blocks nothing else in the
 * story calls), then follow calls depth-first in the order they appear in the code.
 * Calls into other files become stubs unless the reader expanded them.
 */
export function buildStory(graph: CodeGraph, filePath: string, expandedNodeIds: ReadonlySet<string>): Story {
  const members = new Map<string, CodeSymbol>();
  for (const node of graph.nodes.values()) {
    if (node.symbol !== null && (node.path === filePath || expandedNodeIds.has(node.id))) members.set(node.id, node.symbol);
  }
  return flowStory(graph, [...members.values()], { stubs: true, showPath: (symbol) => symbol.filePath !== filePath, foreign: (symbol) => symbol.filePath !== filePath });
}

/**
 * Every changed block of the change set, across files, as one story. "flow" follows calls like a file
 * storyline; "foundations" puts called code before its callers (dependency order); "tests" reads test
 * blocks first; "largest" puts the biggest changes first.
 */
export function buildChangeStory(graph: CodeGraph, changes: ChangeIndex, order: ChangeOrder, sizeOf: (symbol: CodeSymbol) => number): Story {
  const changed = [...changes.entries()]
    .filter(([, info]) => info.status !== null)
    .map(([id]) => mustGet(graph.nodes, id, "Changed node").symbol)
    .filter((symbol): symbol is CodeSymbol => symbol !== null)
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);
  const options: FlowOptions = { stubs: false, showPath: () => true, foreign: () => false };

  switch (order) {
    case "flow":
      return flowStory(graph, changed, options);
    case "tests": {
      const tests = flowStory(graph, changed.filter((symbol) => isTestPath(symbol.filePath)), options);
      const rest = flowStory(graph, changed.filter((symbol) => !isTestPath(symbol.filePath)), options, tests.entries.length);
      return { entries: [...tests.entries, ...rest.entries], calls: callsBetween(graph, changed) };
    }
    case "foundations":
      return columnStory(graph, dependencyOrder(graph, changed), changed);
    case "largest":
      return columnStory(graph, [...changed].sort((a, b) => sizeOf(b) - sizeOf(a)), changed);
  }
}

interface FlowOptions {
  stubs: boolean;
  showPath: (symbol: CodeSymbol) => boolean;
  foreign: (symbol: CodeSymbol) => boolean;
}

/** The depth-first reading order shared by file stories and the "flow" Changes story. */
function flowStory(graph: CodeGraph, symbols: CodeSymbol[], options: FlowOptions, stepOffset = 0): Story {
  const members = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const outgoing = callsBySource(graph.edges);
  const calledByMember = new Set<string>();
  for (const memberId of members.keys()) {
    for (const call of outgoing.get(memberId) ?? []) {
      if (call.target !== memberId) calledByMember.add(call.target);
    }
  }

  const entries: StoryEntry[] = [];
  const calls: StoryCall[] = [];
  const placed = new Set<string>();
  let step = stepOffset;

  const visit = (nodeId: string, depth: number, anchor: StoryEntry["anchor"]): void => {
    if (placed.has(nodeId)) return;
    placed.add(nodeId);
    const symbol = mustGet(members, nodeId, "Story member");
    step += 1;
    entries.push({ item: makeBlock(graph, symbol, step, options), depth, anchor });

    for (const call of outgoing.get(nodeId) ?? []) {
      const line = call.line ?? symbol.startLine;
      if (members.has(call.target)) {
        calls.push(storyCall(nodeId, line, call.target));
        visit(call.target, depth + 1, { parentNodeId: nodeId, line });
      } else if (options.stubs) {
        calls.push(storyCall(nodeId, line, call.target));
        if (placed.has(call.target)) continue;
        placed.add(call.target);
        const node = mustGet(graph.nodes, call.target, "Call target");
        entries.push({ item: { type: "stub", nodeId: node.id, node, expandable: node.kind === "symbol" }, depth: depth + 1, anchor: { parentNodeId: nodeId, line } });
      }
    }
    if (symbol.kind === "class") {
      // Methods nobody in the story calls are the class's public surface: read them after the header.
      for (const method of methodsOf(graph, symbol)) {
        if (members.has(method.id) && !calledByMember.has(method.id)) visit(method.id, depth + 1, { parentNodeId: nodeId, line: method.startLine });
      }
    }
  };

  const roots = symbols.filter((symbol) => isRoot(symbol, members, calledByMember));
  roots.sort((a, b) => entryPriority(a, outgoing) - entryPriority(b, outgoing) || a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);
  roots.forEach((symbol) => visit(symbol.id, 0, null));
  // Blocks only reachable through call cycles still need a place in the story.
  symbols.forEach((symbol) => visit(symbol.id, 0, null));
  return { entries, calls };
}

/** A single reading column in a given order, with arrows for the calls between its blocks. */
function columnStory(graph: CodeGraph, ordered: CodeSymbol[], all: CodeSymbol[]): Story {
  const options: FlowOptions = { stubs: false, showPath: () => true, foreign: () => false };
  return {
    entries: ordered.map((symbol, index) => ({ item: makeBlock(graph, symbol, index + 1, options), depth: 0, anchor: null })),
    calls: callsBetween(graph, all),
  };
}

/** Called code before its callers: a depth-first post-order over the calls between the blocks. */
function dependencyOrder(graph: CodeGraph, symbols: CodeSymbol[]): CodeSymbol[] {
  const members = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const outgoing = callsBySource(graph.edges);
  const ordered: CodeSymbol[] = [];
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    for (const call of outgoing.get(id) ?? []) {
      if (members.has(call.target)) visit(call.target);
    }
    ordered.push(mustGet(members, id, "Story member"));
  };
  symbols.forEach((symbol) => visit(symbol.id));
  return ordered;
}

function callsBetween(graph: CodeGraph, symbols: CodeSymbol[]): StoryCall[] {
  const members = new Set(symbols.map((symbol) => symbol.id));
  const outgoing = callsBySource(graph.edges);
  return symbols.flatMap((symbol) =>
    (outgoing.get(symbol.id) ?? []).filter((call) => members.has(call.target)).map((call) => storyCall(symbol.id, call.line ?? symbol.startLine, call.target)),
  );
}

function storyCall(fromNodeId: string, line: number, toNodeId: string): StoryCall {
  return { id: `${fromNodeId}:${line}->${toNodeId}`, fromNodeId, line, toNodeId };
}

const callsCache = new WeakMap<CodeEdge[], Map<string, CodeEdge[]>>();

/** Call edges grouped by source, each group sorted by call-site line. */
function callsBySource(edges: CodeEdge[]): Map<string, CodeEdge[]> {
  const cached = callsCache.get(edges);
  if (cached) return cached;
  const bySource = new Map<string, CodeEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== "call") continue;
    const group = bySource.get(edge.source);
    if (group) group.push(edge);
    else bySource.set(edge.source, [edge]);
  }
  for (const group of bySource.values()) {
    group.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }
  callsCache.set(edges, bySource);
  return bySource;
}

function isRoot(symbol: CodeSymbol, members: Map<string, CodeSymbol>, calledByMember: Set<string>): boolean {
  if (calledByMember.has(symbol.id)) return false;
  // Methods are reached through their class header when the class is in the story.
  return !(symbol.parentSymbolId !== null && members.has(symbol.parentSymbolId));
}

function entryPriority(symbol: CodeSymbol, outgoing: Map<string, CodeEdge[]>): number {
  if (symbol.origin === "removed") return ENTRY_PRIORITY.removed; // deleted code is read after the code that replaced it
  if (symbol.kind !== "section") return ENTRY_PRIORITY.declaration;
  if (symbol.name.startsWith("imports")) return ENTRY_PRIORITY.imports;
  if (symbol.name.startsWith("types")) return ENTRY_PRIORITY.types;
  if (symbol.name.startsWith("entry point")) return ENTRY_PRIORITY.entry;
  return outgoing.has(symbol.id) ? ENTRY_PRIORITY.runs : ENTRY_PRIORITY.constants;
}

function methodsOf(graph: CodeGraph, classSymbol: CodeSymbol): CodeSymbol[] {
  return mustGet(graph.nodes, classSymbol.id, "Class node")
    .childIds.map((id) => mustGet(graph.nodes, id, "Method node").symbol)
    .filter((symbol): symbol is CodeSymbol => symbol !== null)
    .sort((a, b) => a.startLine - b.startLine);
}

function makeBlock(graph: CodeGraph, symbol: CodeSymbol, step: number, options: FlowOptions): StoryBlock {
  const [displayStart, displayEnd] = displayRange(graph, symbol);
  return { type: "block", nodeId: symbol.id, symbol, displayStart, displayEnd, foreign: options.foreign(symbol), showPath: options.showPath(symbol), step };
}

/** A class card shows only its header (up to its first method in the same version); methods get their own cards. */
function displayRange(graph: CodeGraph, symbol: CodeSymbol): [number, number] {
  if (symbol.kind !== "class") return [symbol.startLine, symbol.endLine];
  const [firstMethod] = methodsOf(graph, symbol).filter((method) => method.origin === symbol.origin);
  if (firstMethod === undefined) return [symbol.startLine, symbol.endLine];
  return [symbol.startLine, Math.max(symbol.startLine, firstMethod.startLine - 1)];
}
