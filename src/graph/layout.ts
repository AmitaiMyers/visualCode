import dagre from "@dagrejs/dagre";
import type { GraphView } from "./view";

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;

export interface Position {
  x: number;
  y: number;
}

/** Left-to-right layered layout. Nodes without edges are placed by dagre as their own components. */
export function layoutView(view: GraphView): Map<string, Position> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 90, marginx: 20, marginy: 20 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const { node } of view.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of view.edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  const positions = new Map<string, Position>();
  for (const { node } of view.nodes) {
    const placed = graph.node(node.id);
    // dagre gives centers; React Flow wants top-left corners.
    positions.set(node.id, { x: placed.x - NODE_WIDTH / 2, y: placed.y - NODE_HEIGHT / 2 });
  }
  return positions;
}
