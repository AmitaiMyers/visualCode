import { get, set } from "idb-keyval";
import type { CodeGraph, ReviewComment } from "../model/types";
import { assert } from "../util/assert";

const EXPORT_FORMAT = "visualcode-review";
const EXPORT_VERSION = 1;

function storageKey(projectId: string): string {
  return `review:${projectId}`;
}

/** Comments are kept per project in IndexedDB, so reloading the same code restores the review. */
export async function loadComments(projectId: string): Promise<ReviewComment[]> {
  const stored = await get<ReviewComment[]>(storageKey(projectId));
  return stored === undefined ? [] : stored;
}

export async function saveComments(projectId: string, comments: ReviewComment[]): Promise<void> {
  await set(storageKey(projectId), comments);
}

export function newComment(nodeId: string, body: string, source: ReviewComment["source"]): ReviewComment {
  return { id: crypto.randomUUID(), nodeId, body, source, resolved: false, createdAt: new Date().toISOString() };
}

export interface ReviewExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  projectId: string;
  exportedAt: string;
  comments: ReviewComment[];
}

export function exportJson(projectId: string, comments: ReviewComment[]): string {
  const payload: ReviewExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    projectId,
    exportedAt: new Date().toISOString(),
    comments,
  };
  return JSON.stringify(payload, null, 2);
}

/** Validates an exported review file. Throws with a clear message on anything unexpected. */
export function parseReviewJson(text: string): ReviewExport {
  const data: unknown = JSON.parse(text);
  assert(typeof data === "object" && data !== null, "Review file must contain a JSON object");
  const payload = data as Record<string, unknown>;
  assert(payload["format"] === EXPORT_FORMAT, `Not a VisualCode review file (format must be "${EXPORT_FORMAT}")`);
  assert(payload["version"] === EXPORT_VERSION, `Unsupported review file version: ${String(payload["version"])}`);
  assert(typeof payload["projectId"] === "string", "Review file is missing projectId");
  assert(Array.isArray(payload["comments"]), "Review file is missing the comments list");
  for (const comment of payload["comments"] as unknown[]) {
    const c = comment as Record<string, unknown>;
    assert(typeof c["id"] === "string" && typeof c["nodeId"] === "string" && typeof c["body"] === "string", "Each comment needs id, nodeId and body");
    assert(c["source"] === "human" || c["source"] === "ai", "Comment source must be human or ai");
    assert(typeof c["resolved"] === "boolean" && typeof c["createdAt"] === "string", "Each comment needs resolved and createdAt");
  }
  return payload as unknown as ReviewExport;
}

/** Imported comments replace local ones with the same id and are added otherwise. */
export function mergeComments(local: ReviewComment[], imported: ReviewComment[]): ReviewComment[] {
  const byId = new Map(local.map((comment) => [comment.id, comment]));
  for (const comment of imported) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Human-readable review grouped by the code location each comment is pinned to. */
export function exportMarkdown(title: string, graph: CodeGraph, comments: ReviewComment[]): string {
  const groups = new Map<string, ReviewComment[]>();
  for (const comment of comments) {
    const group = groups.get(comment.nodeId);
    if (group) group.push(comment);
    else groups.set(comment.nodeId, [comment]);
  }
  const sections = [...groups].map(([nodeId, nodeComments]) => {
    const heading = locationLabel(graph, nodeId);
    const items = nodeComments.map((comment) => {
      const state = comment.resolved ? "x" : " ";
      const tag = comment.source === "ai" ? " _(AI)_" : "";
      return `- [${state}] ${comment.body.replace(/\n/g, "\n  ")}${tag}`;
    });
    return `## ${heading}\n\n${items.join("\n")}`;
  });
  return `# Review: ${title}\n\n${sections.join("\n\n")}\n`;
}

function locationLabel(graph: CodeGraph, nodeId: string): string {
  const node = graph.nodes.get(nodeId);
  if (node === undefined) return `\`${nodeId}\` (not in the loaded code)`;
  if (node.symbol === null) return `\`${node.path === "" ? "/" : node.path}\``;
  const { symbol } = node;
  return `\`${symbol.filePath}\` › ${symbol.qualifiedName} (lines ${symbol.startLine}–${symbol.endLine})`;
}

export function downloadText(fileName: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
