import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { Analysis } from "../analysis/analyze";
import type { CodeGraph, ReviewComment } from "../model/types";
import type { ChangeOrder } from "../graph/story";
import { fileId } from "../model/ids";
import { initialScope, rollUpCounts } from "../graph/view";
import { reviewOrder, type ReviewItem } from "../graph/reviewOrder";
import { saveComments, saveViewed } from "../review/reviewStore";
import { mustGet } from "../util/assert";

export type RailTab = "outline" | "review";
export type CanvasView = "scope" | "changes" | "system";

export interface WorkspaceState {
  analysis: Analysis | null;
  comments: ReviewComment[];
  viewed: ReadonlySet<string>;
  /** True once the reviewer changed comments/viewed for this project, so loading never re-saves. */
  reviewDirty: boolean;
  scopeId: string; // folder (map) or file (storyline)
  selectedId: string | null;
  expandedByFile: ReadonlyMap<string, ReadonlySet<string>>;
  changedOnly: boolean;
  /** Story cards show the lines a diff removed, inline above where they were. */
  showRemoved: boolean;
  /** What the canvas shows: the scope's map or storyline, every changed block as one story, or the system design. */
  canvasView: CanvasView;
  changeOrder: ChangeOrder;
  rail: RailTab;
  inspectorOpen: boolean;
  /** Whether selecting something opens the details panel. Off on phones, where it would cover the canvas. */
  autoOpenInspector: boolean;
}

/** How the details panel behaves, chosen from the screen size when a project opens. */
export interface InspectorLayout {
  inspectorOpen: boolean;
  autoOpenInspector: boolean;
}

export type WorkspaceAction =
  | { type: "projectOpened"; analysis: Analysis; comments: ReviewComment[]; viewed: string[]; layout: InspectorLayout }
  | { type: "navigate"; scopeId: string; selectedId: string | null }
  | { type: "select"; nodeId: string | null }
  | { type: "setExpanded"; filePath: string; nodeId: string; expanded: boolean }
  | { type: "setChangedOnly"; value: boolean }
  | { type: "setShowRemoved"; value: boolean }
  | { type: "setCanvasView"; view: CanvasView }
  | { type: "setChangeOrder"; order: ChangeOrder }
  | { type: "setRail"; rail: RailTab }
  | { type: "setInspectorOpen"; open: boolean }
  | { type: "addComment"; comment: ReviewComment }
  | { type: "toggleResolved"; commentId: string }
  | { type: "removeComment"; commentId: string }
  | { type: "mergeComments"; comments: ReviewComment[] }
  | { type: "setViewed"; nodeId: string; viewed: boolean };

const INITIAL_STATE: WorkspaceState = {
  analysis: null,
  comments: [],
  viewed: new Set(),
  reviewDirty: false,
  scopeId: "",
  selectedId: null,
  expandedByFile: new Map(),
  changedOnly: false,
  showRemoved: true,
  canvasView: "scope",
  changeOrder: "flow",
  rail: "outline",
  inspectorOpen: true,
  autoOpenInspector: true,
};

function isChangedBlock(state: WorkspaceState, nodeId: string): boolean {
  if (state.analysis === null) throw new Error("No project is loaded");
  const change = state.analysis.changes.get(nodeId);
  return change !== undefined && change.status !== null && mustGet(state.analysis.graph.nodes, nodeId, "Node").kind === "symbol";
}

function reviewChange(state: WorkspaceState, patch: Partial<Pick<WorkspaceState, "comments" | "viewed">>): WorkspaceState {
  return { ...state, ...patch, reviewDirty: true };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "projectOpened": {
      const hasDiff = action.analysis.diffByPath.size > 0;
      return {
        ...INITIAL_STATE,
        analysis: action.analysis,
        comments: action.comments,
        viewed: new Set(action.viewed),
        scopeId: initialScope(action.analysis.graph),
        rail: hasDiff ? "review" : "outline",
        ...action.layout,
      };
    }
    case "navigate":
      // Opening a changed block while reading the Changes story selects it there; anything else leaves the story.
      if (state.canvasView === "changes" && action.selectedId !== null && isChangedBlock(state, action.selectedId)) return { ...state, selectedId: action.selectedId };
      return { ...state, scopeId: action.scopeId, selectedId: action.selectedId, canvasView: "scope" };
    case "select":
      return { ...state, selectedId: action.nodeId, inspectorOpen: action.nodeId !== null && state.autoOpenInspector ? true : state.inspectorOpen };
    case "setExpanded": {
      const next = new Map(state.expandedByFile);
      const set = new Set(state.expandedByFile.get(action.filePath) ?? []);
      if (action.expanded) set.add(action.nodeId);
      else set.delete(action.nodeId);
      next.set(action.filePath, set);
      return { ...state, expandedByFile: next };
    }
    case "setChangedOnly":
      return { ...state, changedOnly: action.value };
    case "setShowRemoved":
      return { ...state, showRemoved: action.value };
    case "setCanvasView":
      return { ...state, canvasView: action.view };
    case "setChangeOrder":
      return { ...state, changeOrder: action.order };
    case "setRail":
      return { ...state, rail: action.rail };
    case "setInspectorOpen":
      return { ...state, inspectorOpen: action.open };
    case "addComment":
      return reviewChange(state, { comments: [...state.comments, action.comment] });
    case "toggleResolved":
      return reviewChange(state, {
        comments: state.comments.map((comment) => (comment.id === action.commentId ? { ...comment, resolved: !comment.resolved } : comment)),
      });
    case "removeComment":
      return reviewChange(state, { comments: state.comments.filter((comment) => comment.id !== action.commentId) });
    case "mergeComments": {
      const byId = new Map(state.comments.map((comment) => [comment.id, comment]));
      for (const comment of action.comments) byId.set(comment.id, comment);
      const comments = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return reviewChange(state, { comments });
    }
    case "setViewed": {
      const viewed = new Set(state.viewed);
      if (action.viewed) viewed.add(action.nodeId);
      else viewed.delete(action.nodeId);
      return reviewChange(state, { viewed });
    }
  }
}

const StateContext = createContext<WorkspaceState | null>(null);
const DispatchContext = createContext<Dispatch<WorkspaceAction> | null>(null);

export function WorkspaceProvider({ children, onSaveError }: { children: ReactNode; onSaveError: (message: string) => void }) {
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_STATE);

  // Persist review work (comments + viewed) whenever the reviewer changes it.
  const projectId = state.analysis === null ? null : state.analysis.project.id;
  useEffect(() => {
    if (!state.reviewDirty || projectId === null) return;
    Promise.all([saveComments(projectId, state.comments), saveViewed(projectId, state.viewed)]).catch((reason: unknown) =>
      onSaveError(`Your review could not be saved in this browser: ${reason instanceof Error ? reason.message : String(reason)}`),
    );
  }, [state.comments, state.viewed, state.reviewDirty, projectId, onSaveError]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const state = useContext(StateContext);
  if (state === null) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return state;
}

export function useDispatch(): Dispatch<WorkspaceAction> {
  const dispatch = useContext(DispatchContext);
  if (dispatch === null) throw new Error("useDispatch must be used inside <WorkspaceProvider>");
  return dispatch;
}

/** The loaded analysis; components that call this only render when a project is open. */
export function useAnalysis(): Analysis {
  const { analysis } = useWorkspace();
  if (analysis === null) throw new Error("No project is loaded");
  return analysis;
}

/** Opens a folder (map), a file (storyline) or a block (its file's storyline, block selected). */
export function openNode(graph: CodeGraph, dispatch: Dispatch<WorkspaceAction>, nodeId: string): void {
  const node = mustGet(graph.nodes, nodeId, "Node");
  if (node.kind === "symbol") dispatch({ type: "navigate", scopeId: fileId(node.path), selectedId: nodeId });
  else dispatch({ type: "navigate", scopeId: nodeId, selectedId: null });
}

/** Navigation that understands the hierarchy, bound to the loaded project. */
export function useNavigation() {
  const analysis = useAnalysis();
  const dispatch = useDispatch();
  return useMemo(() => {
    const open = (nodeId: string): void => openNode(analysis.graph, dispatch, nodeId);
    /** Shows a node in context: blocks in their storyline, files and folders selected in their parent's map. */
    const reveal = (nodeId: string): void => {
      const node = mustGet(analysis.graph.nodes, nodeId, "Node");
      if (node.kind === "symbol" || node.parentId === null) open(nodeId);
      else dispatch({ type: "navigate", scopeId: node.parentId, selectedId: nodeId });
    };
    return { open, reveal };
  }, [analysis, dispatch]);
}

/** Changed blocks in reading order with viewed progress, or null when there is no diff. */
export function useReview(): { items: ReviewItem[]; viewedCount: number } | null {
  const { analysis, viewed } = useWorkspace();
  const items = useMemo(() => (analysis === null ? [] : reviewOrder(analysis.graph, analysis.changes)), [analysis]);
  if (analysis === null || items.length === 0) return null;
  return { items, viewedCount: items.filter((item) => viewed.has(item.nodeId)).length };
}

/** Open (unresolved) note counts rolled up to every ancestor. */
export function useNoteCounts(): Map<string, number> {
  const { analysis, comments } = useWorkspace();
  return useMemo(
    () => (analysis === null ? new Map<string, number>() : rollUpCounts(analysis.graph, comments.filter((c) => !c.resolved).map((c) => c.nodeId))),
    [analysis, comments],
  );
}
