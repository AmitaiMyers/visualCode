import { getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import styles from "./StoryCanvas.module.css";

export type FlowState = "rest" | "traced" | "dimmed";

export interface FlowEdgeData extends Record<string, unknown> {
  state: FlowState;
  /** Delay before the arrow draws itself in, or null when it should appear fully drawn. */
  drawDelayMs: number | null;
}

export type FlowEdgeType = Edge<FlowEdgeData, "flow">;

/** The signature ink arrow: a bezier from a call line to the callee's header, with an arrowhead. */
export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<FlowEdgeType>) {
  if (data === undefined) throw new Error(`Flow edge ${id} has no data`);
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
  const markerId = `arrow-${data.state}`;
  return (
    <g className={`${styles.flow} ${styles[data.state]}`}>
      <path
        className={data.drawDelayMs === null ? styles.flowPath : `${styles.flowPath} ${styles.drawing}`}
        style={data.drawDelayMs === null ? undefined : { animationDelay: `${data.drawDelayMs}ms` }}
        d={path}
        pathLength={1}
        markerEnd={`url(#${markerId})`}
      />
      {/* Wide invisible path so the arrow is easy to hover. */}
      <path d={path} className={styles.flowHit} />
    </g>
  );
}

/** Arrowheads for each arrow state, coloured from tokens. Rendered once per canvas. */
export function FlowMarkers() {
  return (
    <svg className={styles.markers} aria-hidden="true">
      <defs>
        {(["rest", "traced", "dimmed"] as const).map((state) => (
          <marker key={state} id={`arrow-${state}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={`${styles.arrowHead} ${styles[state]}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
