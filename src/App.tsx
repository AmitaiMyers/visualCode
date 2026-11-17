import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { analyzeProject, type Analysis } from "./analysis/analyze";
import { askClaude, type AiTask } from "./ai/claude";
import { parseUnifiedDiff } from "./diff/unifiedDiff";
import { fileId } from "./model/ids";
import type { Project, ReviewComment } from "./model/types";
import { ancestry, initialScope, rollUpCounts } from "./graph/view";
import {
  downloadText,
  exportJson,
  exportMarkdown,
  loadComments,
  mergeComments,
  newComment,
  parseReviewJson,
  saveComments,
} from "./review/reviewStore";
import { loadSettings, persistSettings, type Settings } from "./settings";
import { errorMessage, mustGet } from "./util/assert";
import { DetailsPanel } from "./components/DetailsPanel";
import { DiffDialog } from "./components/DiffDialog";
import { LoadDialog } from "./components/LoadDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { MapCanvas } from "./components/map/MapCanvas";
import { StoryCanvas } from "./components/story/StoryCanvas";

type DialogName = "load" | "settings" | "diff" | null;

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentsDirty, setCommentsDirty] = useState(false); // true once the user changed comments of this project
  const [scopeId, setScopeId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedByFile, setExpandedByFile] = useState<Map<string, ReadonlySet<string>>>(new Map());
  const [changedOnly, setChangedOnly] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // Comment counts include every comment inside a folder/file, so collapsed nodes show totals.
  const commentCounts = useMemo(
    () => (analysis === null ? new Map<string, number>() : rollUpCounts(analysis.graph, comments.filter((c) => !c.resolved).map((c) => c.nodeId))),
    [analysis, comments],
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** Runs an async action with a progress label. This is the single place errors are shown to the user. */
  function runTask(label: string, task: (onProgress: (message: string) => void) => Promise<void>): void {
    setError(null);
    setBusy(label);
    task(setBusy)
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(null));
  }

  async function openProject(project: Project, onProgress: (message: string) => void): Promise<void> {
    onProgress(`Analysing ${project.files.length} files…`);
    const nextAnalysis = await analyzeProject(project);
    const storedComments = await loadComments(project.id);
    setAnalysis(nextAnalysis);
    setComments(storedComments);
    setCommentsDirty(false);
    setScopeId(initialScope(nextAnalysis.graph));
    setSelectedId(null);
    setExpandedByFile(new Map());
    setChangedOnly(false);
    if (nextAnalysis.skippedDiffPaths.length > 0) {
      setNotice(`${nextAnalysis.skippedDiffPaths.length} changed files are not JS/TS/Python and are not shown.`);
    }
  }

  // Functional update, so a slow AI answer never overwrites comments added meanwhile.
  function updateComments(update: (current: ReviewComment[]) => ReviewComment[]): void {
    setComments(update);
    setCommentsDirty(true);
  }

  const projectId = analysis === null ? null : analysis.project.id;
  useEffect(() => {
    if (!commentsDirty || projectId === null) return;
    saveComments(projectId, comments).catch((reason: unknown) => setError(`Could not save comments: ${errorMessage(reason)}`));
  }, [comments, commentsDirty, projectId]);

  function requireAnalysis(): Analysis {
    if (analysis === null) throw new Error("No project is loaded");
    return analysis;
  }

  // ----- navigation -----

  function openNode(nodeId: string): void {
    const node = mustGet(requireAnalysis().graph.nodes, nodeId, "Node");
    if (node.kind === "symbol") {
      setScopeId(fileId(node.path));
      setSelectedId(nodeId);
      return;
    }
    setScopeId(nodeId);
    setSelectedId(null);
  }

  /** Shows a node in context: blocks in their file's storyline, files/folders in their parent's map. */
  function revealNode(nodeId: string): void {
    const node = mustGet(requireAnalysis().graph.nodes, nodeId, "Node");
    if (node.kind === "symbol" || node.parentId === null) {
      openNode(nodeId);
      return;
    }
    setScopeId(node.parentId);
    setSelectedId(nodeId);
  }

  function setExpanded(filePath: string, nodeId: string, expand: boolean): void {
    setExpandedByFile((current) => {
      const next = new Map(current);
      const set = new Set(current.get(filePath) ?? []);
      if (expand) set.add(nodeId);
      else set.delete(nodeId);
      next.set(filePath, set);
      return next;
    });
    setSelectedId(nodeId);
  }

  // ----- actions -----

  function askAi(nodeId: string, task: AiTask): void {
    const current = requireAnalysis();
    const node = mustGet(current.graph.nodes, nodeId, "Node");
    setError(null);
    setAiBusy(true);
    askClaude(settings.claudeApiKey, current, node, task)
      .then((answer) => updateComments((existing) => [...existing, newComment(nodeId, answer, "ai")]))
      .catch((reason: unknown) => setError(`Claude: ${errorMessage(reason)}`))
      .finally(() => setAiBusy(false));
  }

  function applyDiff(diffText: string): void {
    const current = requireAnalysis();
    setDialog(null);
    runTask("Applying diff…", async (progress) => {
      const diff = parseUnifiedDiff(diffText);
      await openProject({ ...current.project, diff }, progress);
    });
  }

  function importReview(file: File): void {
    runTask("Importing review…", async () => {
      const review = parseReviewJson(await file.text());
      updateComments((existing) => mergeComments(existing, review.comments));
      const fromOther = review.projectId !== requireAnalysis().project.id ? ` (exported from ${review.projectId})` : "";
      setNotice(`Imported ${review.comments.length} comments${fromOther}.`);
    });
  }

  function exportReview(format: "json" | "md"): void {
    const current = requireAnalysis();
    const safeName = current.project.title.replace(/[^\w.-]+/g, "-");
    if (format === "json") {
      downloadText(`${safeName}.review.json`, exportJson(current.project.id, comments), "application/json");
    } else {
      downloadText(`${safeName}.review.md`, exportMarkdown(current.project.title, current.graph, comments), "text/markdown");
    }
  }

  // ----- render -----

  const scopeNode = analysis !== null && scopeId !== "" ? mustGet(analysis.graph.nodes, scopeId, "Scope") : null;
  // The panel is always shown (the scope when nothing is selected) so the canvas never resizes under a double-click.
  const panelNodeId = selectedId ?? scopeId;
  const hasDiff = analysis !== null && analysis.diffByPath.size > 0;

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <img src="./icon.svg" alt="" width={24} height={24} />
          <span>VisualCode</span>
        </div>
        {analysis !== null && <span className="project-title" title={analysis.project.title}>{analysis.project.title}</span>}
        <nav className="top-bar__actions">
          <button className="primary-button" onClick={() => setDialog("load")}>
            Load code
          </button>
          {analysis !== null && (
            <>
              <button className="ghost-button edit-only" onClick={() => setDialog("diff")}>
                Review a diff
              </button>
              {hasDiff && (
                <label className="toggle">
                  <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
                  Changed only
                </label>
              )}
              <button className="ghost-button" onClick={() => exportReview("md")} disabled={comments.length === 0}>
                Export .md
              </button>
              <button className="ghost-button edit-only" onClick={() => exportReview("json")} disabled={comments.length === 0}>
                Export .json
              </button>
              <button className="ghost-button edit-only" onClick={() => importInput.current?.click()}>
                Import review
              </button>
              <input
                ref={importInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.item(0);
                  if (file) importReview(file);
                  event.target.value = "";
                }}
              />
            </>
          )}
          <button className="ghost-button" onClick={() => setDialog("settings")} aria-label="Settings">
            ⚙︎
          </button>
        </nav>
      </header>

      {error !== null && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {notice !== null && <div className="banner banner--info">{notice}</div>}

      {analysis === null || scopeNode === null ? (
        <Welcome onLoad={() => setDialog("load")} />
      ) : (
        <main className="workspace">
          <div className="canvas-area">
            <Breadcrumbs analysis={analysis} scopeId={scopeId} onNavigate={openNode} />
            <div className="canvas">
              <ReactFlowProvider>
                {scopeNode.kind === "file" ? (
                  <StoryCanvas
                    analysis={analysis}
                    filePath={scopeNode.path}
                    expandedNodeIds={expandedByFile.get(scopeNode.path) ?? EMPTY_SET}
                    selectedId={selectedId}
                    commentCounts={commentCounts}
                    onSelect={setSelectedId}
                    onExpand={(nodeId) => setExpanded(scopeNode.path, nodeId, true)}
                    onCollapse={(nodeId) => setExpanded(scopeNode.path, nodeId, false)}
                    onOpenFile={(path) => openNode(fileId(path))}
                  />
                ) : (
                  <MapCanvas
                    analysis={analysis}
                    scopeId={scopeId}
                    changedOnly={changedOnly}
                    selectedId={selectedId}
                    commentCounts={commentCounts}
                    onSelect={setSelectedId}
                    onOpen={openNode}
                  />
                )}
              </ReactFlowProvider>
              <Legend storyline={scopeNode.kind === "file"} />
            </div>
          </div>
          <DetailsPanel
              analysis={analysis}
              nodeId={panelNodeId}
              comments={comments}
              aiAvailable={settings.claudeApiKey !== ""}
              aiBusy={aiBusy}
              onAddComment={(nodeId, body) => updateComments((existing) => [...existing, newComment(nodeId, body, "human")])}
              onToggleResolved={(id) => updateComments((existing) => existing.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)))}
              onDeleteComment={(id) => updateComments((existing) => existing.filter((c) => c.id !== id))}
              onAskAi={askAi}
              onOpen={openNode}
              onReveal={revealNode}
            />
        </main>
      )}

      {busy !== null && (
        <div className="busy-overlay" role="status">
          <div className="busy-overlay__card">
            <span className="spinner" aria-hidden="true" />
            {busy}
          </div>
        </div>
      )}
      {aiBusy && <div className="ai-busy" role="status">Asking Claude…</div>}

      {dialog === "load" && (
        <LoadDialog
          githubToken={settings.githubToken}
          onClose={() => setDialog(null)}
          onLoad={(label, load) => {
            setDialog(null);
            runTask(label, async (progress) => openProject(await load(progress), progress));
          }}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            persistSettings(next);
            setSettings(next);
            setDialog(null);
          }}
        />
      )}
      {dialog === "diff" && <DiffDialog onApply={applyDiff} onClose={() => setDialog(null)} />}
    </div>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function Breadcrumbs({ analysis, scopeId, onNavigate }: { analysis: Analysis; scopeId: string; onNavigate: (nodeId: string) => void }) {
  const chain = ancestry(analysis.graph, scopeId);
  return (
    <nav className="breadcrumbs" aria-label="Location">
      {chain.map((id, index) => {
        const node = mustGet(analysis.graph.nodes, id, "Breadcrumb node");
        const isLast = index === chain.length - 1;
        return (
          <span key={id} className="breadcrumbs__item">
            {isLast ? (
              <strong>{node.label}</strong>
            ) : (
              <button className="link-button" onClick={() => onNavigate(id)}>
                {node.label}
              </button>
            )}
            {!isLast && <span className="breadcrumbs__sep">/</span>}
          </span>
        );
      })}
      <span className="breadcrumbs__hint muted">
        {mustGet(analysis.graph.nodes, scopeId, "Scope").kind === "file"
          ? "Storyline: read top to bottom, follow arrows right into called code"
          : "Double-click a file to read its storyline"}
      </span>
    </nav>
  );
}

function Legend({ storyline }: { storyline: boolean }) {
  return (
    <div className="legend" aria-label="Legend">
      <span className="legend__item"><i className="swatch swatch--added" /> added</span>
      <span className="legend__item"><i className="swatch swatch--modified" /> changed</span>
      <span className="legend__item"><i className="swatch swatch--deleted" /> deleted</span>
      {storyline ? (
        <span className="legend__item"><i className="swatch swatch--call" /> call line</span>
      ) : (
        <span className="legend__item"><i className="swatch swatch--ghost" /> outside folder</span>
      )}
    </div>
  );
}

function Welcome({ onLoad }: { onLoad: () => void }) {
  return (
    <main className="welcome">
      <h1>Read code as a story, not a file</h1>
      <p>
        Code is written top to bottom, but logic doesn't flow that way. VisualCode cuts each file into blocks (functions,
        classes and module-level sections) and rearranges them by what calls what. You read from the entry point down and
        follow arrows from each call to the code it runs.
      </p>
      <ol className="welcome__steps">
        <li>Load a public GitHub repo or pull request, a local folder, or pasted code.</li>
        <li>Explore the folder map, then double-click a file to read its storyline.</li>
        <li>Review: changed blocks are highlighted. Pin comments to blocks, then export the review.</li>
      </ol>
      <button className="primary-button primary-button--large" onClick={onLoad}>
        Load code
      </button>
      <p className="muted">JavaScript, TypeScript and Python. Everything runs in your browser and works offline once installed.</p>
    </main>
  );
}
