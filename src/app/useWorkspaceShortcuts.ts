import { useShortcuts } from "../state/useShortcuts";
import { useAnalysis, useDispatch, useNavigation, useReview, useWorkspace } from "../state/workspace";
import { mustGet } from "../util/assert";
import { fileId } from "../model/ids";

export const NOTE_COMPOSER_ID = "note-composer";

/** Review and navigation shortcuts for a loaded project: N, Shift+N, V, C, M, Esc. */
export function useWorkspaceShortcuts(reviewEnabled: boolean): void {
  const analysis = useAnalysis();
  const { scopeId, selectedId, viewed } = useWorkspace();
  const { changes } = analysis;
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const review = useReview();

  const stepChange = (direction: 1 | -1): void => {
    if (review === null) return;
    const index = review.items.findIndex((item) => item.nodeId === selectedId);
    const next = index === -1 ? (direction === 1 ? 0 : review.items.length - 1) : (index + direction + review.items.length) % review.items.length;
    const item = review.items[next];
    if (item !== undefined) navigation.open(item.nodeId);
  };

  const toggleMapStory = (): void => {
    const scope = mustGet(analysis.graph.nodes, scopeId, "Scope");
    if (scope.kind === "file") {
      if (scope.parentId !== null) dispatch({ type: "navigate", scopeId: scope.parentId, selectedId: scope.id });
      return;
    }
    if (selectedId === null) return;
    const selected = mustGet(analysis.graph.nodes, selectedId, "Selection");
    if (selected.kind === "file") navigation.open(selected.id);
    else if (selected.kind === "symbol") navigation.open(fileId(selected.path));
  };

  const goUp = (): void => {
    if (selectedId !== null) {
      dispatch({ type: "select", nodeId: null });
      return;
    }
    const scope = mustGet(analysis.graph.nodes, scopeId, "Scope");
    if (scope.parentId !== null) dispatch({ type: "navigate", scopeId: scope.parentId, selectedId: scope.id });
  };

  useShortcuts({
    n: () => stepChange(1),
    "shift+n": () => stepChange(-1),
    v: () => {
      if (!reviewEnabled || selectedId === null || !changes.has(selectedId)) return;
      dispatch({ type: "setViewed", nodeId: selectedId, viewed: !viewed.has(selectedId) });
    },
    c: () => {
      if (selectedId === null) return;
      dispatch({ type: "setInspectorOpen", open: true });
      // The composer renders with the inspector; focus it on the next frame.
      requestAnimationFrame(() => document.getElementById(NOTE_COMPOSER_ID)?.focus());
    },
    m: toggleMapStory,
    escape: goUp,
  });
}
