import type { Story, StoryBlock, StoryEntry } from "../../graph/story";
import { mustGet } from "../../util/assert";

export const CARD_WIDTH = 560;
export const STUB_WIDTH = 300;
export const COLUMN_GAP = 140;
export const HEADER_HEIGHT = 36;
export const LINE_HEIGHT = 18;
export const FOOTER_HEIGHT = 28;
export const BODY_PADDING = 8;
export const STUB_HEIGHT = 58;
export const ROW_GAP = 24;
export const MAX_COLLAPSED_LINES = 24;

export interface CardGeometry {
  x: number;
  y: number;
  height: number;
  shownLines: number; // number of source lines rendered
  truncated: boolean;
}

/** How many lines a block card shows, and whether it is cut short. */
export function cardLines(block: StoryBlock, fullyOpen: boolean): { shownLines: number; truncated: boolean } {
  const total = block.displayEnd - block.displayStart + 1;
  const shownLines = fullyOpen ? total : Math.min(total, MAX_COLLAPSED_LINES);
  return { shownLines, truncated: shownLines < total };
}

/** Vertical offset inside a block card where a call on the given source line leaves the card. */
export function lineOffset(block: StoryBlock, shownLines: number, truncated: boolean, line: number): number {
  const index = line - block.displayStart;
  if (index >= 0 && index < shownLines) {
    return HEADER_HEIGHT + BODY_PADDING / 2 + index * LINE_HEIGHT + LINE_HEIGHT / 2;
  }
  // Calls from lines that are hidden (truncated card, or a class field after the header) leave from the bottom.
  const bodyBottom = HEADER_HEIGHT + BODY_PADDING + shownLines * LINE_HEIGHT;
  return truncated ? bodyBottom + FOOTER_HEIGHT / 2 : bodyBottom - LINE_HEIGHT / 2;
}

/**
 * Places the story: depth 0 is the main reading column, each call depth one column to the right.
 * A callee is placed level with the line that calls it (or lower, if its column is occupied).
 * Every new top-level entry starts below everything placed so far, so the story reads in chapters.
 */
export function layoutStory(story: Story, openCards: ReadonlySet<string>): Map<string, CardGeometry> {
  const geometry = new Map<string, CardGeometry>();
  const columnBottom: number[] = [];
  const bottomOf = (depth: number): number => columnBottom[depth] ?? 0;
  const blocks = new Map<string, StoryBlock>();
  for (const entry of story.entries) {
    if (entry.item.type === "block") blocks.set(entry.item.nodeId, entry.item);
  }

  for (const entry of story.entries) {
    const { height, shownLines, truncated } = measure(entry, openCards);
    const x = entry.depth * (CARD_WIDTH + COLUMN_GAP);
    const y =
      entry.anchor === null
        ? Math.max(0, ...columnBottom)
        : Math.max(bottomOf(entry.depth), anchorY(entry.anchor, blocks, geometry));
    geometry.set(entry.item.nodeId, { x, y, height, shownLines, truncated });
    columnBottom[entry.depth] = y + height + ROW_GAP;
  }
  return geometry;
}

function measure(entry: StoryEntry, openCards: ReadonlySet<string>): { height: number; shownLines: number; truncated: boolean } {
  if (entry.item.type === "stub") return { height: STUB_HEIGHT, shownLines: 0, truncated: false };
  const { shownLines, truncated } = cardLines(entry.item, openCards.has(entry.item.nodeId));
  const height = HEADER_HEIGHT + BODY_PADDING + shownLines * LINE_HEIGHT + (truncated ? FOOTER_HEIGHT : 0);
  return { height, shownLines, truncated };
}

/** Top of a card so that its header lines up with the calling line of its parent. */
function anchorY(
  anchor: NonNullable<StoryEntry["anchor"]>,
  blocks: Map<string, StoryBlock>,
  geometry: Map<string, CardGeometry>,
): number {
  const parent = mustGet(geometry, anchor.parentNodeId, "Parent card geometry");
  const parentBlock = mustGet(blocks, anchor.parentNodeId, "Parent block");
  const offset = lineOffset(parentBlock, parent.shownLines, parent.truncated, anchor.line);
  return parent.y + offset - HEADER_HEIGHT / 2;
}
