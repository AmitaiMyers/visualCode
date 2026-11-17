/**
 * The system design of a project: deployable apps, the data stores and brokers they use, external
 * services, and the connections between them. Detected from code and config, then edited by the reader.
 */

export type ComponentKind = "frontend" | "service" | "worker" | "database" | "cache" | "queue" | "storage" | "external";

/** Where in the project a component or connection was seen. */
export interface Evidence {
  path: string;
  line: number | null;
  note: string; // what was seen, e.g. "imports ioredis" or "compose service"
}

export interface SystemComponent {
  id: string;
  name: string;
  kind: ComponentKind;
  technology: string | null; // catalog technology id (redis, postgres…) or a framework label (express, react…)
  rootPath: string | null; // app folder ("" = project root) for apps built from this project's code
  evidence: Evidence[];
  origin: "detected" | "added";
}

export interface SystemConnection {
  id: string;
  from: string;
  to: string;
  label: string; // protocol and detail, e.g. "HTTP POST /api/checkout" or "SQL"
  evidence: Evidence[];
  origin: "detected" | "added";
}

export interface SystemDesign {
  components: SystemComponent[];
  connections: SystemConnection[];
}

/** The tier a component sits in, left to right: who calls whom. */
export const KIND_TIER: Record<ComponentKind, number> = {
  frontend: 0,
  service: 1,
  worker: 1,
  database: 2,
  cache: 2,
  queue: 2,
  storage: 2,
  external: 2,
};

export const KIND_LABEL: Record<ComponentKind, string> = {
  frontend: "Frontend",
  service: "Service",
  worker: "Worker",
  database: "Database",
  cache: "Cache",
  queue: "Message broker",
  storage: "Object storage",
  external: "External service",
};

export function connectionId(from: string, to: string): string {
  return `${from}->${to}`;
}
