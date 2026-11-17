import { ReactFlowProvider } from "@xyflow/react";
import { BookOpenText, ChevronRight, FileDiff, GitCompareArrows, Network, PanelRight, Server, type LucideIcon } from "lucide-react";
import { ancestry } from "../graph/view";
import { fileId } from "../model/ids";
import { useAnalysis, useDispatch, useNavigation, useWorkspace } from "../state/workspace";
import { mustGet } from "../util/assert";
import { Button, IconButton } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { MapCanvas } from "../canvas/map/MapCanvas";
import { SystemCanvas } from "../canvas/system/SystemCanvas";
import { ChangesStoryCanvas, FileStoryCanvas } from "../canvas/story/StoryCanvas";
import type { ChangeOrder } from "../graph/story";
import styles from "./CanvasArea.module.css";

type ViewMode = "map" | "story" | "changes" | "system";

const CHANGE_ORDERS: { value: ChangeOrder; label: string }[] = [
  { value: "flow", label: "Call flow" },
  { value: "foundations", label: "Foundations first" },
  { value: "tests", label: "Tests first" },
  { value: "largest", label: "Largest first" },
];

interface CanvasAreaProps {
  reviewEnabled: boolean;
  aiKey: string;
  onReviewDiff: () => void;
  onAddApiKey: () => void;
}

const HINTS: Record<ViewMode, string> = {
  map: "Click to select · click twice to open",
  story: "J / K to walk the story · click a highlighted line to follow its call",
  changes: "J / K to walk the changes · click a highlighted line to follow its call",
  system: "Click for details · drag to move · drag from a dot to another component to connect",
};

/** A view switch label: icon and word; on phones only the icon shows, the word stays for screen readers. */
function viewLabel(Icon: LucideIcon, text: string) {
  return (
    <>
      <Icon size={14} aria-hidden="true" />
      <span className={styles.viewText}>{text}</span>
    </>
  );
}

export function CanvasArea({ reviewEnabled, aiKey, onReviewDiff, onAddApiKey }: CanvasAreaProps) {
  const analysis = useAnalysis();
  const { scopeId, selectedId, changedOnly, inspectorOpen, canvasView, changeOrder } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const scope = mustGet(analysis.graph.nodes, scopeId, "Scope");
  const scopeMode: ViewMode = scope.kind === "file" ? "story" : "map";
  const mode: ViewMode = canvasView === "scope" ? scopeMode : canvasView;
  const hasDiff = analysis.diffByPath.size > 0;

  const storyTarget = (): string | null => {
    if (selectedId === null) return null;
    const selected = mustGet(analysis.graph.nodes, selectedId, "Selection");
    if (selected.kind === "file") return selected.id;
    if (selected.kind === "symbol") return fileId(selected.path);
    return null;
  };

  const switchMode = (next: ViewMode): void => {
    if (next === mode) return;
    if (next === "changes" || next === "system") {
      dispatch({ type: "setCanvasView", view: next });
      return;
    }
    if (canvasView !== "scope") dispatch({ type: "setCanvasView", view: "scope" });
    if (next === scopeMode) return;
    if (next === "map") {
      if (scope.parentId !== null)
        dispatch({
          type: "navigate",
          scopeId: scope.parentId,
          selectedId: scope.id,
        });
      return;
    }
    const target = storyTarget();
    if (target !== null) navigation.open(target);
  };

  return (
    <section className={styles.area} aria-label="Canvas">
      <div className={styles.bar}>
        {mode === "changes" || mode === "system" ? (
          <p className={styles.crumbs}>
            <strong>{mode === "changes" ? "All changes" : "System design"}</strong>
            <span className="muted">&nbsp;· {mode === "changes" ? "across files" : "apps, data stores, connections"}</span>
          </p>
        ) : (
          <nav className={styles.crumbs} aria-label="Location">
            {ancestry(analysis.graph, scopeId).map((id, index, chain) => {
              const node = mustGet(analysis.graph.nodes, id, "Breadcrumb");
              const isLast = index === chain.length - 1;
              return (
                <span key={id} className={styles.crumb}>
                  {isLast ? (
                    <strong aria-current="page">{node.label}</strong>
                  ) : (
                    <button type="button" className={styles.crumbLink} onClick={() => navigation.open(id)}>
                      {node.label}
                    </button>
                  )}
                  {!isLast && <ChevronRight size={14} className={styles.crumbSep} aria-hidden="true" />}
                </span>
              );
            })}
          </nav>
        )}
        <div className={styles.controls}>
          {mode === "changes" && (
            <label className={styles.toggle}>
              Order
              <select
                className={styles.select}
                value={changeOrder}
                onChange={(event) =>
                  dispatch({
                    type: "setChangeOrder",
                    order: event.target.value as ChangeOrder,
                  })
                }
              >
                {CHANGE_ORDERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "map" && hasDiff && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(event) =>
                  dispatch({
                    type: "setChangedOnly",
                    value: event.target.checked,
                  })
                }
              />
              Changed only
            </label>
          )}
          {!hasDiff && (
            <Button size="sm" variant="ghost" icon={FileDiff} onClick={onReviewDiff} className="edit-only">
              Review a diff
            </Button>
          )}
          <SegmentedControl<ViewMode>
            label="View"
            value={mode}
            onChange={switchMode}
            segments={[
              {
                value: "map",
                label: viewLabel(Network, "Map"),
              },
              {
                value: "story",
                label: viewLabel(BookOpenText, "Story"),
                disabledReason: mode !== "story" && scopeMode === "map" && storyTarget() === null ? "Select a file to read its storyline" : undefined,
              },
              ...(hasDiff
                ? [
                    {
                      value: "changes" as const,
                      label: viewLabel(GitCompareArrows, "Changes"),
                    },
                  ]
                : []),
              {
                value: "system",
                label: viewLabel(Server, "System"),
              },
            ]}
          />
          {mode !== "system" && (
            <IconButton
              icon={PanelRight}
              label={inspectorOpen ? "Hide details" : "Show details"}
              pressed={inspectorOpen}
              onClick={() => dispatch({ type: "setInspectorOpen", open: !inspectorOpen })}
            />
          )}
        </div>
      </div>
      <div className={styles.canvas} id="canvas" tabIndex={-1}>
        <ReactFlowProvider key={mode === "changes" ? `changes:${changeOrder}` : mode === "system" ? "system" : scopeId}>
          {mode === "changes" && <ChangesStoryCanvas order={changeOrder} reviewEnabled={reviewEnabled} />}
          {mode === "story" && <FileStoryCanvas filePath={scope.path} reviewEnabled={reviewEnabled} />}
          {mode === "map" && <MapCanvas scopeId={scopeId} />}
          {mode === "system" && <SystemCanvas aiKey={aiKey} onAddApiKey={onAddApiKey} />}
        </ReactFlowProvider>
        <p className={styles.hint} aria-hidden="true">
          {HINTS[mode]}
        </p>
      </div>
    </section>
  );
}
