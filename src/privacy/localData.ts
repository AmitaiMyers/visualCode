import { clear, delMany } from "idb-keyval";
import { clearSettings } from "../settings";

/**
 * Everything VisualCode keeps per project in this browser's IndexedDB. Loaded code itself is never
 * stored; notes can quote it, so they count as project data too.
 */
export const PROJECT_KEYS = {
  comments: (projectId: string) => `review:${projectId}`,
  viewed: (projectId: string) => `viewed:${projectId}`,
  systemEdits: (projectId: string) => `system:${projectId}`,
  aiConsent: (projectId: string) => `ai-consent:${projectId}`,
} as const;

/** Deletes one project's notes, viewed marks, system edits and AI consent. */
export async function clearProjectData(projectId: string): Promise<void> {
  await delMany(Object.values(PROJECT_KEYS).map((key) => key(projectId)));
}

/** Deletes every project's data, the keys and the preferences. */
export async function clearAllData(): Promise<void> {
  await clear();
  clearSettings();
}
