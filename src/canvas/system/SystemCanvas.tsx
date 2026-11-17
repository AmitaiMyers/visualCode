import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, BackgroundVariant, MarkerType, Panel, ReactFlow, useReactFlow, type Connection, type Edge } from "@xyflow/react";
import { Download, Maximize, Plus, RotateCcw } from "lucide-react";
import type { Analysis } from "../../analysis/analyze";
import { useAnalysis } from "../../state/workspace";
import { errorMessage } from "../../util/assert";
import { Button, IconButton } from "../../ui/Button";
import { useToast } from "../../ui/Toasts";
import { detectSystem } from "../../system/detect";
import { addComponent, addConnection, applyEdits, loadSystemEdits, moveItem, removeItem, saveSystemEdits, type SystemEdits } from "../../system/edits";
import { NODE_HEIGHT, NODE_WIDTH, layoutSystem } from "../../system/layout";
import { TECHNOLOGIES } from "../../system/catalog";
import type { SystemComponent, SystemDesign } from "../../system/model";
import { SystemNode, type SystemNodeType } from "./SystemNode";
import { SystemPanel } from "./SystemPanel";
import { AddComponentDialog, ExportSystemDialog, type CatalogChoice } from "./SystemDialogs";
import styles from "./SystemCanvas.module.css";

const NODE_TYPES = { component: SystemNode };
const PANEL_SPACE = 444; // the details panel's width plus its margins
const detectedCache = new WeakMap<Analysis, SystemDesign>();

/** Detection reads every file, so it runs once per loaded project. */
function detectedDesign(analysis: Analysis): SystemDesign {
  const cached = detectedCache.get(analysis);
  if (cached !== undefined) return cached;
  const design = detectSystem(analysis.contents);
  detectedCache.set(analysis, design);
  return design;
}

/** The reader's edits for this project, loaded from and saved to the browser. */
function useSystemEdits(projectId: string): [SystemEdits | null, (change: (edits: SystemEdits) => SystemEdits) => void] {
  const toast = useToast();
  const [edits, setEdits] = useState<SystemEdits | null>(null);
  useEffect(() => {
    let current = true;
    loadSystemEdits(projectId).then(
      (loaded) => current && setEdits(loaded),
      (reason: unknown) => toast({ message: `Your system edits could not be loaded: ${errorMessage(reason)}`, tone: "error" }),
    );
    return () => {
      current = false;
    };
  }, [projectId, toast]);
  const update = useCallback(
    (change: (edits: SystemEdits) => SystemEdits) =>
      setEdits((previous) => {
        if (previous === null) throw new Error("System edits changed before they loaded");
        const next = change(previous);
        saveSystemEdits(projectId, next).catch((reason: unknown) => toast({ message: `Your system edits could not be saved: ${errorMessage(reason)}`, tone: "error" }));
        return next;
      }),
    [projectId, toast],
  );
  return [edits, update];
}

/** The system design: apps, data stores and external services with their connections, detected and editable. */
export function SystemCanvas({ aiKey, onAddApiKey }: { aiKey: string; onAddApiKey: () => void }) {
  const analysis = useAnalysis();
  const [edits, updateEdits] = useSystemEdits(analysis.project.id);
  if (edits === null) return <div className={styles.loading} aria-busy="true" />;
  return <SystemView analysis={analysis} edits={edits} updateEdits={updateEdits} aiKey={aiKey} onAddApiKey={onAddApiKey} />;
}

interface SystemViewProps {
  analysis: Analysis;
  edits: SystemEdits;
  updateEdits: (change: (edits: SystemEdits) => SystemEdits) => void;
  aiKey: string;
  onAddApiKey: () => void;
}

function SystemView({ analysis, edits, updateEdits, aiKey, onAddApiKey }: SystemViewProps) {
  const flow = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"add" | "export" | null>(null);
  const design = useMemo(() => applyEdits(detectedDesign(analysis), edits), [analysis, edits]);
  const positions = useMemo(() => layoutSystem(design.components, edits.positions), [design, edits.positions]);
  const selectionExists = selectedId !== null && (design.components.some((c) => c.id === selectedId) || design.connections.some((c) => c.id === selectedId));

  // Keep the selection in view beside the details panel, which covers the right of the canvas.
  useEffect(() => {
    if (selectedId === null) return;
    const connection = design.connections.find((candidate) => candidate.id === selectedId);
    const ends = connection === undefined ? [selectedId] : [connection.from, connection.to];
    const points = ends.flatMap((id) => {
      const position = positions.get(id);
      return position === undefined ? [] : [{ x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT / 2 }];
    });
    if (points.length === 0) return;
    const zoom = flow.getZoom();
    const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    void flow.setCenter(x + PANEL_SPACE / 2 / zoom, y, { zoom, duration: 300 });
    // Only a new selection moves the camera; dragging or editing must not.
  }, [selectedId]);

  const nodes: SystemNodeType[] = design.components.map((component) => {
    const position = positions.get(component.id);
    if (position === undefined) throw new Error(`No position for ${component.id}`);
    return {
      id: component.id,
      type: "component",
      position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      ariaLabel: `${component.name}, ${component.kind}`,
      data: { component, selected: component.id === selectedId },
    };
  });
  const edges: Edge[] = design.connections.map((connection) => ({
    id: connection.id,
    source: connection.from,
    target: connection.to,
    label: connection.label,
    className: [styles.edge, connection.origin === "added" ? styles.edgeAdded : "", connection.id === selectedId ? styles.edgeSelected : ""].join(" "),
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }));

  const remove = (id: string): void => {
    updateEdits((current) => removeItem(current, id));
    setSelectedId(null);
  };

  const addFromCatalog = (choice: CatalogChoice): void => {
    const existingIds = new Set(design.components.map((component) => component.id));
    const { edits: withComponent, id } = addComponent(edits, choice, existingIds);
    // A data store or broker is used by an app: connect it to the selected app, or the only service there is.
    const services = design.components.filter((component) => component.rootPath !== null && component.kind !== "frontend");
    const selected = design.components.find((component) => component.id === selectedId && component.rootPath !== null);
    const user = choice.technology === null ? undefined : (selected ?? (services.length === 1 ? services[0] : undefined));
    const technology = TECHNOLOGIES.find((candidate) => candidate.id === choice.technology);
    updateEdits(() => (user === undefined || technology === undefined ? withComponent : addConnection(withComponent, user.id, id, technology.protocol)));
    setSelectedId(id);
    setDialog(null);
  };

  const onConnect = (connection: Connection): void => {
    const target = design.components.find((component) => component.id === connection.target);
    if (target === undefined) throw new Error(`Connection to an unknown component: ${connection.target}`);
    updateEdits((current) => addConnection(current, connection.source, connection.target, connectionLabelFor(target)));
  };

  const hiddenCount = edits.hidden.length;

  return (
    <div
      className={styles.canvas}
      data-panel={selectionExists ? "open" : "closed"}
      onKeyDown={(event) => {
        // Delete removes the selection, unless the reader is typing (renaming a component).
        const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
        if ((event.key === "Delete" || event.key === "Backspace") && !typing && selectionExists && selectedId !== null) remove(selectedId);
      }}
    >
      {design.components.length === 0 ? (
        <div className={styles.empty}>
          <h2>No system found yet</h2>
          <p className="muted">VisualCode reads docker compose, Kubernetes manifests, package manifests and client libraries. None were found; add the parts by hand.</p>
          <Button variant="primary" icon={Plus} onClick={() => setDialog("add")} className="edit-only">
            Add component
          </Button>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onEdgeClick={(_, edge) => setSelectedId(edge.id)}
          onPaneClick={() => setSelectedId(null)}
          onNodeDragStop={(_, node) => updateEdits((current) => moveItem(current, node.id, node.position))}
          onConnect={onConnect}
          deleteKeyCode={null}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
          <Panel position="top-left" className={styles.toolbar}>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setDialog("add")} className="edit-only">
              Add component
            </Button>
            <Button size="sm" icon={Download} onClick={() => setDialog("export")}>
              Export
            </Button>
            {hiddenCount > 0 && (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => updateEdits((current) => ({ ...current, hidden: [] }))} className="edit-only">
                Restore {hiddenCount} removed
              </Button>
            )}
          </Panel>
          <Panel position="bottom-right" className={styles.toolbar}>
            <IconButton icon={Maximize} label="Fit to content" tooltipSide="top" onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 300 })} />
          </Panel>
        </ReactFlow>
      )}
      {selectionExists && selectedId !== null && (
        <SystemPanel
          design={design}
          selectedId={selectedId}
          aiKey={aiKey}
          onAddApiKey={onAddApiKey}
          onRemove={remove}
          onRename={(id, name) => updateEdits((current) => ({ ...current, added: current.added.map((component) => (component.id === id ? { ...component, name } : component)) }))}
          onClose={() => setSelectedId(null)}
        />
      )}
      {dialog === "add" && <AddComponentDialog onAdd={addFromCatalog} onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportSystemDialog design={design} projectName={analysis.project.title} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** What a hand-drawn connection says, from what it points at. */
function connectionLabelFor(target: SystemComponent): string {
  const technology = TECHNOLOGIES.find((candidate) => candidate.id === target.technology);
  if (technology !== undefined) return technology.protocol;
  return target.kind === "external" ? "HTTPS" : "HTTP";
}
