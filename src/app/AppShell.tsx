import { useEffect, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { DEMO_DIFF, DEMO_FILES, DEMO_ID, DEMO_TITLE } from "../demo/sampleProject";
import { entriesFromDrop, loadFromEntries, loadFromZip } from "../ingest/localFiles";
import { applyTheme, loadSettings, persistSettings, type Settings } from "../settings";
import { useShortcuts } from "../state/useShortcuts";
import { useWorkspace } from "../state/workspace";
import { errorMessage } from "../util/assert";
import { IconButton } from "../ui/Button";
import { CanvasArea } from "./CanvasArea";
import { CommandPalette } from "./CommandPalette";
import { Inspector } from "./Inspector";
import { LeftRail } from "./LeftRail";
import { TopBar } from "./TopBar";
import { Welcome } from "./Welcome";
import { DiffDialog } from "./dialogs/DiffDialog";
import { ExportDialog } from "./dialogs/ExportDialog";
import { LoadDialog, type LoadTab } from "./dialogs/LoadDialog";
import { SettingsDialog } from "./dialogs/SettingsDialog";
import { ShortcutsDialog } from "./dialogs/ShortcutsDialog";
import { useProjectLoader, type ProjectSource } from "./useProjectLoader";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import styles from "./AppShell.module.css";

type OpenDialog =
  | { name: "load"; tab: LoadTab }
  | { name: "settings" }
  | { name: "diff" }
  | { name: "export" }
  | { name: "shortcuts" }
  | null;

/** The demo project: a small checkout service with one pull request's changes applied. */
const DEMO_SOURCE: ProjectSource = async () => ({
  id: DEMO_ID,
  title: DEMO_TITLE,
  files: DEMO_FILES,
  diff: parseUnifiedDiff(DEMO_DIFF),
});

export function AppShell() {
  const { analysis } = useWorkspace();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(() => window.matchMedia("(min-width: 761px)").matches);
  const { progress, openProject } = useProjectLoader();

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  /** Opens a project from outside a dialog (demo, drop); failures show in the banner. */
  const openWithBanner = (source: ProjectSource): void => {
    setBanner(null);
    openProject(source).catch((reason: unknown) => setBanner(errorMessage(reason)));
  };

  const dropping = useDropToLoad((items) =>
    openWithBanner(async () => {
      const entries = await entriesFromDrop(items);
      const [only] = entries;
      if (entries.length === 1 && only !== undefined && /\.zip$/i.test(only.path)) return loadFromZip(only.file);
      return loadFromEntries(entries);
    }),
  );

  useShortcuts({
    "mod+k": () => setPaletteOpen((open) => !open),
    "?": () => setDialog({ name: "shortcuts" }),
  });

  const openLoad = (tab: LoadTab): void => setDialog({ name: "load", tab });
  const reviewEnabled = settings.reviewChecklist;

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#canvas">
        Skip to canvas
      </a>
      <TopBar
        railOpen={railOpen}
        reviewEnabled={reviewEnabled}
        onToggleRail={() => setRailOpen((open) => !open)}
        onLoad={() => openLoad("github")}
        onSearch={() => setPaletteOpen(true)}
        onExport={() => setDialog({ name: "export" })}
        onSettings={() => setDialog({ name: "settings" })}
        onShortcuts={() => setDialog({ name: "shortcuts" })}
      />
      <div className={styles.progress} role={progress === null ? undefined : "progressbar"} aria-label={progress?.message} aria-hidden={progress === null}>
        {progress !== null && (
          <span
            className={progress.fraction === null ? styles.indeterminate : styles.determinate}
            style={progress.fraction === null ? undefined : { width: `${Math.round(progress.fraction * 100)}%` }}
          />
        )}
      </div>
      {progress !== null && (
        <div className={styles.status} role="status">
          {progress.message}
        </div>
      )}
      {banner !== null && (
        <div className={styles.banner} role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>{banner}</p>
          <IconButton icon={X} label="Dismiss" onClick={() => setBanner(null)} />
        </div>
      )}

      {analysis === null ? (
        <Welcome
          loading={progress !== null}
          githubToken={settings.githubToken}
          onOpen={openProject}
          onDemo={() => openWithBanner(DEMO_SOURCE)}
          onMoreOptions={openLoad}
        />
      ) : (
        <Workspace
          railOpen={railOpen}
          reviewEnabled={reviewEnabled}
          aiKey={settings.claudeApiKey}
          onCloseRail={() => setRailOpen(false)}
          onReviewDiff={() => setDialog({ name: "diff" })}
          onAddApiKey={() => setDialog({ name: "settings" })}
        />
      )}

      {dialog?.name === "load" && (
        <LoadDialog
          initialTab={dialog.tab}
          githubToken={settings.githubToken}
          onOpen={async (source) => {
            await openProject(source);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.name === "settings" && (
        <SettingsDialog
          settings={settings}
          onSave={(next) => {
            persistSettings(next);
            setSettings(next);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.name === "diff" && analysis !== null && (
        <DiffDialog
          onApply={async (diffText) => {
            const diff = parseUnifiedDiff(diffText);
            await openProject(async () => ({ ...analysis.project, diff }));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.name === "export" && analysis !== null && <ExportDialog reviewEnabled={reviewEnabled} onClose={() => setDialog(null)} />}
      {dialog?.name === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          commands={[
            { id: "load", label: "Load code", run: () => openLoad("github") },
            { id: "demo", label: "Open the demo project", run: () => openWithBanner(DEMO_SOURCE) },
            ...(analysis === null
              ? []
              : [
                  { id: "diff", label: "Review a diff", run: () => setDialog({ name: "diff" }) },
                  { id: "export", label: "Export review", run: () => setDialog({ name: "export" }) },
                ]),
            { id: "settings", label: "Settings", run: () => setDialog({ name: "settings" }) },
            { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "?", run: () => setDialog({ name: "shortcuts" }) },
          ]}
        />
      )}
      {dropping && (
        <div className={styles.drop} aria-hidden="true">
          <p>Drop a folder or .zip to open it</p>
        </div>
      )}
    </div>
  );
}

interface WorkspaceProps {
  railOpen: boolean;
  reviewEnabled: boolean;
  aiKey: string;
  onCloseRail: () => void;
  onReviewDiff: () => void;
  onAddApiKey: () => void;
}

/** Rail, canvas and inspector for a loaded project. */
function Workspace({ railOpen, reviewEnabled, aiKey, onCloseRail, onReviewDiff, onAddApiKey }: WorkspaceProps) {
  const { inspectorOpen } = useWorkspace();
  useWorkspaceShortcuts(reviewEnabled);
  return (
    <main className={styles.workspace} data-rail={railOpen ? "open" : "closed"} data-inspector={inspectorOpen ? "open" : "closed"}>
      {railOpen && <LeftRail reviewEnabled={reviewEnabled} onClose={onCloseRail} />}
      <CanvasArea reviewEnabled={reviewEnabled} onReviewDiff={onReviewDiff} />
      {inspectorOpen && <Inspector reviewEnabled={reviewEnabled} aiKey={aiKey} onAddApiKey={onAddApiKey} />}
    </main>
  );
}

/** Shows the drop overlay while files are dragged over the window and hands dropped items over. */
function useDropToLoad(onDrop: (items: DataTransferItemList) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;

  useEffect(() => {
    let depth = 0; // dragenter/leave fire for every child element
    const hasFiles = (event: DragEvent): boolean => event.dataTransfer !== null && [...event.dataTransfer.types].includes("Files");
    const enter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth -= 1;
      if (depth <= 0) setDragging(false);
    };
    const over = (event: DragEvent): void => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent): void => {
      if (!hasFiles(event) || event.dataTransfer === null) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      latest.current(event.dataTransfer.items);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return dragging;
}
