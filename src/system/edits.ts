import { get, set } from "idb-keyval";
import { PROJECT_KEYS } from "../privacy/localData";
import { connectionId, type ComponentKind, type SystemComponent, type SystemConnection, type SystemDesign } from "./model";

export interface Position {
  x: number;
  y: number;
}

/**
 * The reader's changes on top of the detected design: components and connections they added, detected
 * ones they removed, and where they moved cards. Detection reruns on every load; edits stay.
 */
export interface SystemEdits {
  added: SystemComponent[];
  addedConnections: SystemConnection[];
  hidden: string[]; // ids of detected components and connections the reader removed
  positions: Record<string, Position>;
}

export const NO_EDITS: SystemEdits = { added: [], addedConnections: [], hidden: [], positions: {} };

export async function loadSystemEdits(projectId: string): Promise<SystemEdits> {
  const stored = await get<SystemEdits>(PROJECT_KEYS.systemEdits(projectId));
  return stored === undefined ? NO_EDITS : stored;
}

export async function saveSystemEdits(projectId: string, edits: SystemEdits): Promise<void> {
  await set(PROJECT_KEYS.systemEdits(projectId), edits);
}

/** The design the reader sees: detected minus removed, plus added. Connections to removed components go too. */
export function applyEdits(detected: SystemDesign, edits: SystemEdits): SystemDesign {
  const hidden = new Set(edits.hidden);
  const components = [...detected.components.filter((component) => !hidden.has(component.id)), ...edits.added];
  const present = new Set(components.map((component) => component.id));
  const connections = [...detected.connections, ...edits.addedConnections].filter(
    (connection) => !hidden.has(connection.id) && present.has(connection.from) && present.has(connection.to),
  );
  return { components, connections };
}

export function addComponent(edits: SystemEdits, draft: { name: string; kind: ComponentKind; technology: string | null }, existingIds: ReadonlySet<string>): { edits: SystemEdits; id: string } {
  const id = uniqueId(`added:${slug(draft.name)}`, existingIds);
  const component: SystemComponent = { id, ...draft, rootPath: null, evidence: [], origin: "added" };
  return { edits: { ...edits, added: [...edits.added, component] }, id };
}

export function addConnection(edits: SystemEdits, from: string, to: string, label: string): SystemEdits {
  const id = connectionId(from, to);
  if (from === to || edits.addedConnections.some((connection) => connection.id === id)) return edits;
  const connection: SystemConnection = { id, from, to, label, evidence: [], origin: "added" };
  return { ...edits, addedConnections: [...edits.addedConnections, connection], hidden: edits.hidden.filter((hiddenId) => hiddenId !== id) };
}

/** Removes a component or connection: added ones are deleted, detected ones hidden (restorable). */
export function removeItem(edits: SystemEdits, id: string): SystemEdits {
  const isAdded = edits.added.some((component) => component.id === id) || edits.addedConnections.some((connection) => connection.id === id);
  if (isAdded) {
    return {
      ...edits,
      added: edits.added.filter((component) => component.id !== id),
      addedConnections: edits.addedConnections.filter((connection) => connection.id !== id && connection.from !== id && connection.to !== id),
    };
  }
  return edits.hidden.includes(id) ? edits : { ...edits, hidden: [...edits.hidden, id] };
}

export function moveItem(edits: SystemEdits, id: string, position: Position): SystemEdits {
  return { ...edits, positions: { ...edits.positions, [id]: position } };
}

function slug(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned === "" ? "component" : cleaned;
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}
