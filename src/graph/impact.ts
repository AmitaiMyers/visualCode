import type { CodeEdge, CodeGraph, CodeNode } from "../model/types";
import { fileId } from "../model/ids";
import { mustGet } from "../util/assert";
import { isTestPath } from "./tests";

/** How far up the call chain affected tests are looked for. */
export const TEST_SEARCH_DEPTH = 3;

/** Code that uses a node: callers of a block, importers of a file. */
export interface CallerGroup {
  filePath: string;
  callers: { nodeId: string; label: string; line: number | null }[];
}

/** A test that reaches the node: directly (distance 1) or through a chain of callers. */
export interface AffectedTest {
  nodeId: string;
  filePath: string;
  label: string;
  distance: number;
}

export interface Impact {
  callerGroups: CallerGroup[];
  callerCount: number; // use sites (one caller can call from several lines)
  tests: AffectedTest[];
}

const reverseCache = new WeakMap<CodeEdge[], Map<string, CodeEdge[]>>();

/** Edges grouped by target: who calls a block, who imports a file. */
function edgesByTarget(edges: CodeEdge[]): Map<string, CodeEdge[]> {
  const cached = reverseCache.get(edges);
  if (cached) return cached;
  const byTarget = new Map<string, CodeEdge[]>();
  for (const edge of edges) {
    const group = byTarget.get(edge.target);
    if (group) group.push(edge);
    else byTarget.set(edge.target, [edge]);
  }
  reverseCache.set(edges, byTarget);
  return byTarget;
}

/** Direct users of a node, one edge per use site: call edges into a block, import edges into a file. Self-calls are not users. */
function usersOf(graph: CodeGraph, node: CodeNode): CodeEdge[] {
  const kind = node.kind === "file" ? "import" : "call";
  const sites = new Map<string, CodeEdge>();
  for (const edge of edgesByTarget(graph.edges).get(node.id) ?? []) {
    if (edge.kind === kind && edge.source !== node.id) sites.set(`${edge.source}:${edge.line ?? ""}`, edge);
  }
  return [...sites.values()];
}

/**
 * What a change to this block or file can affect: who uses it, grouped by file, and the tests that reach it
 * through up to TEST_SEARCH_DEPTH callers. Test files that import the block's file count as direct.
 */
export function impactOf(graph: CodeGraph, nodeId: string): Impact {
  const node = mustGet(graph.nodes, nodeId, "Impact node");
  if (node.kind === "folder") throw new Error("Impact is computed for files and blocks, not folders.");

  const users = usersOf(graph, node);
  const groups = new Map<string, CallerGroup>();
  for (const edge of users) {
    const user = mustGet(graph.nodes, edge.source, "Caller");
    const group = groups.get(user.path) ?? { filePath: user.path, callers: [] };
    group.callers.push({ nodeId: user.id, label: labelOf(user), line: edge.line });
    groups.set(user.path, group);
  }
  const callerGroups = [...groups.values()].sort((a, b) => a.filePath.localeCompare(b.filePath));
  return { callerGroups, callerCount: users.length, tests: affectedTests(graph, node) };
}

function affectedTests(graph: CodeGraph, node: CodeNode): AffectedTest[] {
  const tests = new Map<string, AffectedTest>();
  const record = (user: CodeNode, distance: number): void => {
    if (isTestPath(user.path) && !tests.has(user.id)) tests.set(user.id, { nodeId: user.id, filePath: user.path, label: labelOf(user), distance });
  };

  if (node.kind === "symbol") {
    const seen = new Set([node.id]);
    let frontier = [node];
    for (let distance = 1; distance <= TEST_SEARCH_DEPTH && frontier.length > 0; distance += 1) {
      const next: CodeNode[] = [];
      for (const current of frontier) {
        for (const edge of usersOf(graph, current)) {
          if (seen.has(edge.source)) continue;
          seen.add(edge.source);
          const caller = mustGet(graph.nodes, edge.source, "Caller");
          record(caller, distance);
          next.push(caller);
        }
      }
      frontier = next;
    }
  }
  // Test files that import this code are affected directly, unless a test in them was already found by its calls.
  const ownFile = mustGet(graph.nodes, fileId(node.path), "File node");
  const filesWithTests = new Set([...tests.values()].map((test) => test.filePath));
  for (const edge of usersOf(graph, ownFile)) {
    const importer = mustGet(graph.nodes, edge.source, "Importer");
    if (!filesWithTests.has(importer.path)) record(importer, 1);
  }
  return [...tests.values()].sort((a, b) => a.distance - b.distance || a.filePath.localeCompare(b.filePath) || a.label.localeCompare(b.label));
}

/** Number of direct use sites, for the caller chip on cards. */
export function callerCount(graph: CodeGraph, nodeId: string): number {
  return usersOf(graph, mustGet(graph.nodes, nodeId, "Node")).length;
}

function labelOf(node: CodeNode): string {
  if (node.symbol === null) return node.label;
  return node.symbol.kind === "section" ? node.symbol.name : node.symbol.qualifiedName;
}
