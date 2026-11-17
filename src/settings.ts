// User settings. Preferences are always remembered; keys stay in memory unless the user opts in.

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  claudeApiKey: string;
  githubToken: string;
  rememberKeys: boolean;
  theme: ThemePreference;
  /** Review checklist, viewed state and progress. Off hides them everywhere. */
  reviewChecklist: boolean;
}

const KEYS_STORAGE = "visualcode:settings";
const PREFS_STORAGE = "visualcode:prefs";

const DEFAULTS: Settings = { claudeApiKey: "", githubToken: "", rememberKeys: false, theme: "system", reviewChecklist: true };

function readJson(key: string): Record<string, unknown> | null {
  const stored = localStorage.getItem(key);
  return stored === null ? null : (JSON.parse(stored) as Record<string, unknown>);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function loadSettings(): Settings {
  const keys = readJson(KEYS_STORAGE);
  const prefs = readJson(PREFS_STORAGE);
  const theme = prefs !== null && (prefs["theme"] === "light" || prefs["theme"] === "dark") ? prefs["theme"] : DEFAULTS.theme;
  return {
    claudeApiKey: keys === null ? "" : stringOr(keys["claudeApiKey"], ""),
    githubToken: keys === null ? "" : stringOr(keys["githubToken"], ""),
    rememberKeys: keys !== null,
    theme,
    reviewChecklist: prefs === null || prefs["reviewChecklist"] !== false,
  };
}

export function persistSettings(settings: Settings): void {
  localStorage.setItem(PREFS_STORAGE, JSON.stringify({ theme: settings.theme, reviewChecklist: settings.reviewChecklist }));
  if (settings.rememberKeys) {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify({ claudeApiKey: settings.claudeApiKey, githubToken: settings.githubToken }));
  } else {
    localStorage.removeItem(KEYS_STORAGE);
  }
}

/** Applies the theme preference to the document (system = no attribute, CSS follows the OS). */
export function applyTheme(theme: ThemePreference): void {
  if (theme === "system") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = theme;
  }
}
