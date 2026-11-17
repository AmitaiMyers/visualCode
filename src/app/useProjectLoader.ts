import { useCallback, useState } from "react";
import { analyzeProject } from "../analysis/analyze";
import type { Project } from "../model/types";
import type { LoadProgress, ProgressListener } from "../ingest/github";
import { loadComments, loadViewed } from "../review/reviewStore";
import { useDispatch } from "../state/workspace";
import { useToast } from "../ui/Toasts";

/** Wide screens show details beside the canvas; tablets open them on demand; phones only via the Details button. */
function inspectorLayoutForViewport() {
  const wide = window.matchMedia("(min-width: 1101px)").matches;
  const phone = window.matchMedia("(max-width: 760px)").matches;
  return { inspectorOpen: wide, autoOpenInspector: !phone };
}

export type ProjectSource = (onProgress: ProgressListener) => Promise<Project>;

/**
 * Loads, analyses and opens a project, reporting progress for the top bar.
 * The returned promise rejects on failure so the caller can show the error where it happened.
 */
export function useProjectLoader(): { progress: LoadProgress | null; openProject: (source: ProjectSource) => Promise<void> } {
  const dispatch = useDispatch();
  const toast = useToast();
  const [progress, setProgress] = useState<LoadProgress | null>(null);

  const openProject = useCallback(
    async (source: ProjectSource) => {
      setProgress({ message: "Reading code…", fraction: null });
      try {
        const project = await source(setProgress);
        setProgress({ message: `Analysing ${project.files.length} files…`, fraction: null });
        const analysis = await analyzeProject(project);
        const [comments, viewed] = await Promise.all([loadComments(project.id), loadViewed(project.id)]);
        dispatch({ type: "projectOpened", analysis, comments, viewed, layout: inspectorLayoutForViewport() });
        const changed = [...analysis.diffByPath.keys()].length;
        const parts = [`Loaded ${project.title}`, `${project.files.length} files`];
        if (changed > 0) parts.push(`${changed} changed`);
        if (analysis.skippedDiffPaths.length > 0) parts.push(`${analysis.skippedDiffPaths.length} non-code changes not shown`);
        toast({ message: parts.join(" · "), tone: "success" });
      } finally {
        setProgress(null); // the only finally: progress must clear whether loading worked or not
      }
    },
    [dispatch, toast],
  );

  return { progress, openProject };
}
