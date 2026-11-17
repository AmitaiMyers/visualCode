import type { RemovedLine } from "../../model/types";
import type { Story, StoryEntry } from "../../graph/story";
import { mustGet } from "../../util/assert";

// Geometry from the design system: 560px cards, 40px headers, 20px code lines, 120px between columns.
export const CARD_WIDTH = 560;
export const STUB_WIDTH = 320;
export const COLUMN_GAP = 120;
export const HEADER_HEIGHT = 40;
export const LINE_HEIGHT = 20;
export const FOOTER_HEIGHT = 28;
export const BODY_PADDING = 12;
export const STUB_HEIGHT = 56;
export const ROW_GAP = 24;
export const MAX_COLLAPSED_ROWS = 24;

/** One row of a card body: a source line (with its number) or a line the diff removed, shown inline above where it was. */
export type CardRow = { kind: "line"; line: number; text: string } | { kind: "removed"; oldLine: number; text: string };

export interface CardGeometry {
  x: number;
  y: number;
  height: number;
  shownRows: number; // rows rendered (the rest are behind "Show all")
  truncated: boolean;
}

/**
 * The rows of a block card: its lines, each preceded by the removed lines that sat directly above it.
 * Lines removed after the card's last line belong to whatever follows, so they are not repeated here.
 */
export function cardRows(firstLine: number, lines: string[], removedAbove: (line: number) => RemovedLine[]): CardRow[] {
  return lines.flatMap((text, index): CardRow[] => {
    const line = firstLine + index;
    return [...removedAbove(line).map((removed): CardRow => ({ kind: "removed", ...removed })), { kind: "line", line, text }];
  });
}

export function visibleRows(total: number, fullyOpen: boolean): { shownRows: number; truncated: boolean } {
  const shownRows = fullyOpen ? total : Math.min(total, MAX_COLLAPSED_ROWS);
  return { shownRows, truncated: shownRows < total };
}

export function blockHeight(shownRows: number, truncated: boolean): number {
  return HEADER_HEIGHT + BODY_PADDING + shownRows * LINE_HEIGHT + (truncated ? FOOTER_HEIGHT : 0);
}

/** Vertical offset inside a card where a call on the given source line leaves it. */
export function lineOffset(rows: CardRow[], shownRows: number, truncated: boolean, line: number): number {
  const index = rows.findIndex((row) => row.kind === "line" && row.line === line);
  if (index >= 0 && index < shownRows) {
    return HEADER_HEIGHT + BODY_PADDING / 2 + index * LINE_HEIGHT + LINE_HEIGHT / 2;
  }
  // Calls from hidden lines (truncated card, or a class field after the header) leave from the bottom.
  const bodyBottom = HEADER_HEIGHT + BODY_PADDING + shownRows * LINE_HEIGHT;
  return truncated ? bodyBottom + FOOTER_HEIGHT / 2 : bodyBottom - LINE_HEIGHT / 2;
}

/**
 * Places the story: depth 0 is the main reading column, each call depth one column to the right.
 * A callee is placed level with the line that calls it (or lower, if its column is occupied).
 * Every new top-level entry starts below everything placed so far, so the story reads in chapters.
 */
export function layoutStory(story: Story, rowsOf: (nodeId: string) => CardRow[], openCards: ReadonlySet<string>): Map<string, CardGeometry> {
  const geometry = new Map<string, CardGeometry>();
  const columnBottom: number[] = [];
  const bottomOf = (depth: number): number => columnBottom[depth] ?? 0;

  for (const entry of story.entries) {
    const { height, shownRows, truncated } = measure(entry, rowsOf, openCards);
    const x = entry.depth * (CARD_WIDTH + COLUMN_GAP);
    const y =
      entry.anchor === null
        ? Math.max(0, ...columnBottom)
        : Math.max(bottomOf(entry.depth), anchorY(entry.anchor, rowsOf, geometry));
    geometry.set(entry.item.nodeId, { x, y, height, shownRows, truncated });
    columnBottom[entry.depth] = y + height + ROW_GAP;
  }
  return geometry;
}

function measure(entry: StoryEntry, rowsOf: (nodeId: string) => CardRow[], openCards: ReadonlySet<string>) {
  if (entry.item.type === "stub") return { height: STUB_HEIGHT, shownRows: 0, truncated: false };
  const { shownRows, truncated } = visibleRows(rowsOf(entry.item.nodeId).length, openCards.has(entry.item.nodeId));
  return { height: blockHeight(shownRows, truncated), shownRows, truncated };
}

/** Top of a card so that its header lines up with the calling line of its parent. */
function anchorY(anchor: NonNullable<StoryEntry["anchor"]>, rowsOf: (nodeId: string) => CardRow[], geometry: Map<string, CardGeometry>): number {
  const parent = mustGet(geometry, anchor.parentNodeId, "Parent card geometry");
  const offset = lineOffset(rowsOf(anchor.parentNodeId), parent.shownRows, parent.truncated, anchor.line);
  return parent.y + offset - HEADER_HEIGHT / 2;
}
