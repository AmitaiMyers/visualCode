import { KIND_TIER, type ComponentKind, type SystemComponent } from "./model";
import type { Position } from "./edits";

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 76;
const COLUMN_GAP = 140;
const ROW_GAP = 28;

const KIND_ORDER: ComponentKind[] = ["frontend", "service", "worker", "database", "cache", "queue", "storage", "external"];

/**
 * Places components in columns by tier (frontends, then services and workers, then what they use),
 * each column centred on the tallest one. Positions the reader dragged to win.
 */
export function layoutSystem(components: SystemComponent[], moved: Record<string, Position>): Map<string, Position> {
  const columns = new Map<number, SystemComponent[]>();
  for (const component of components) {
    const tier = KIND_TIER[component.kind];
    columns.set(tier, [...(columns.get(tier) ?? []), component]);
  }
  const tallest = Math.max(0, ...[...columns.values()].map((column) => column.length));
  const positions = new Map<string, Position>();
  for (const [tier, column] of columns) {
    column.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
    const offset = ((tallest - column.length) * (NODE_HEIGHT + ROW_GAP)) / 2;
    column.forEach((component, index) => {
      positions.set(component.id, moved[component.id] ?? { x: tier * (NODE_WIDTH + COLUMN_GAP), y: offset + index * (NODE_HEIGHT + ROW_GAP) });
    });
  }
  return positions;
}
