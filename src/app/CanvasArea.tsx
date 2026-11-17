import { ReactFlowProvider } from "@xyflow/react";
import { BookOpenText, ChevronRight, FileDiff, Network, PanelRight } from "lucide-react";
import { ancestry } from "../graph/view";
import { fileId } from "../model/ids";
import { useAnalysis, useDispatch, useNavigation, useWorkspace } from "../state/workspace";
import { mustGet } from "../util/assert";
import { Button, IconButton } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { MapCanvas } from "../canvas/map/MapCanvas";
import { StoryCanvas } from "../canvas/story/StoryCanvas";
import styles from "./CanvasArea.module.css";

type ViewMode = "map" | "story";

export function CanvasArea({ reviewEnabled, onReviewDiff }: { reviewEnabled: boolean; onReviewDiff: () => void }) {
  const analysis = useAnalysis();
  const { scopeId, selectedId, changedOnly, inspectorOpen } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const scope = mustGet(analysis.graph.nodes, scopeId, "Scope");
  const mode: ViewMode = scope.kind === "file" ? "story" : "map";
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
    if (next === "map") {
      if (scope.parentId !== null) dispatch({ type: "navigate", scopeId: scope.parentId, selectedId: scope.id });
      return;
    }
    const target = storyTarget();
    if (target !== null) navigation.open(target);
  };

  return (
    <section className={styles.area} aria-label="Canvas">
      <div className={styles.bar}>
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
        <div className={styles.controls}>
          {mode === "map" && hasDiff && (
            <label className={styles.toggle}>
              <input type="checkbox" checked={changedOnly} onChange={(event) => dispatch({ type: "setChangedOnly", value: event.target.checked })} />
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
              { value: "map", label: <><Network size={14} aria-hidden="true" /> Map</> },
              {
                value: "story",
                label: <><BookOpenText size={14} aria-hidden="true" /> Story</>,
                disabledReason: mode === "map" && storyTarget() === null ? "Select a file to read its storyline" : undefined,
              },
            ]}
          />
          <IconButton
            icon={PanelRight}
            label={inspectorOpen ? "Hide details" : "Show details"}
            pressed={inspectorOpen}
            onClick={() => dispatch({ type: "setInspectorOpen", open: !inspectorOpen })}
          />
        </div>
      </div>
      <div className={styles.canvas} id="canvas" tabIndex={-1}>
        <ReactFlowProvider key={scopeId}>
          {mode === "story" ? <StoryCanvas filePath={scope.path} reviewEnabled={reviewEnabled} /> : <MapCanvas scopeId={scopeId} />}
        </ReactFlowProvider>
        <p className={styles.hint} aria-hidden="true">
          {mode === "story" ? "J / K to walk the story · click a highlighted line to follow its call" : "Click to select · click twice to open"}
        </p>
      </div>
    </section>
  );
}
