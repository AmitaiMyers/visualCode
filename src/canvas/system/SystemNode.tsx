import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowLeftRight, Cog, Database, Globe, HardDrive, Monitor, Server, Zap, type LucideIcon } from "lucide-react";
import { TECHNOLOGIES } from "../../system/catalog";
import { MAX_EVIDENCE } from "../../system/detect";
import { KIND_LABEL, type ComponentKind, type SystemComponent } from "../../system/model";
import { NODE_HEIGHT, NODE_WIDTH } from "../../system/layout";
import styles from "./SystemCanvas.module.css";

export const KIND_ICON: Record<ComponentKind, LucideIcon> = {
  frontend: Monitor,
  service: Server,
  worker: Cog,
  database: Database,
  cache: Zap,
  queue: ArrowLeftRight,
  storage: HardDrive,
  external: Globe,
};

export interface SystemNodeData extends Record<string, unknown> {
  component: SystemComponent;
  selected: boolean;
}

export type SystemNodeType = Node<SystemNodeData, "component">;

export function technologyName(component: SystemComponent): string | null {
  return TECHNOLOGIES.find((technology) => technology.id === component.technology)?.label ?? component.technology;
}

/** One app, data store or external service: icon, name, kind and technology, and how much code backs it. */
export const SystemNode = memo(function SystemNode({ data }: NodeProps<SystemNodeType>) {
  const { component } = data;
  const Icon = KIND_ICON[component.kind];
  const technology = technologyName(component);
  const classes = [styles.node, styles[`kind-${component.kind}`], component.origin === "added" ? styles.nodeAdded : "", data.selected ? styles.nodeSelected : ""];
  return (
    <div className={classes.join(" ")} style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <span className={styles.nodeIcon} aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className={styles.nodeText}>
        <span className={styles.nodeName}>{component.name}</span>
        <span className={styles.nodeMeta}>
          {KIND_LABEL[component.kind]}
          {technology !== null && ` · ${technology}`}
        </span>
        <span className={styles.nodeEvidence}>{component.origin === "added" ? "Planned · not in the code yet" : `Seen in ${evidenceCount(component.evidence.length)}`}</span>
      </span>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
});

/** "1 place", "4 places", "6+ places": detection keeps at most MAX_EVIDENCE examples. */
export function evidenceCount(count: number): string {
  return `${count}${count >= MAX_EVIDENCE ? "+" : ""} ${count === 1 ? "place" : "places"}`;
}
