// User settings. Preferences are always remembered. Keys stay in this tab (sessionStorage) unless the
// reader chooses this device (localStorage): every page on this origin can read either, and on
// github.io the origin is shared with the owner's other GitHub Pages sites, so the tab is the default.

export type ThemePreference = "system" | "light" | "dark";

/** Where API keys are kept: until this tab closes, or on this device until cleared. */
export type KeyStorage = "tab" | "device";

export interface Settings {
  claudeApiKey: string;
  githubToken: string;
  keyStorage: KeyStorage;
  theme: ThemePreference;
  /** Review checklist, viewed state and progress. Off hides them everywhere. */
  reviewChecklist: boolean;
}

const KEYS_STORAGE = "visualcode:settings";
const PREFS_STORAGE = "visualcode:prefs";

export const DEFAULT_SETTINGS: Settings = { claudeApiKey: "", githubToken: "", keyStorage: "tab", theme: "system", reviewChecklist: true };

function readJson(storage: Storage, key: string): Record<string, unknown> | null {
  const stored = storage.getItem(key);
  return stored === null ? null : (JSON.parse(stored) as Record<string, unknown>);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function loadSettings(): Settings {
  const deviceKeys = readJson(localStorage, KEYS_STORAGE);
  const keys = deviceKeys ?? readJson(sessionStorage, KEYS_STORAGE);
  const prefs = readJson(localStorage, PREFS_STORAGE);
  const theme = prefs !== null && (prefs["theme"] === "light" || prefs["theme"] === "dark") ? prefs["theme"] : DEFAULT_SETTINGS.theme;
  return {
    claudeApiKey: keys === null ? "" : stringOr(keys["claudeApiKey"], ""),
    githubToken: keys === null ? "" : stringOr(keys["githubToken"], ""),
    keyStorage: deviceKeys === null ? "tab" : "device",
    theme,
    reviewChecklist: prefs === null || prefs["reviewChecklist"] !== false,
  };
}

export function persistSettings(settings: Settings): void {
  localStorage.setItem(PREFS_STORAGE, JSON.stringify({ theme: settings.theme, reviewChecklist: settings.reviewChecklist }));
  // Keys live in exactly one place; the other is cleared so switching to "tab" really forgets them on this device.
  const [keep, drop] = settings.keyStorage === "device" ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
  drop.removeItem(KEYS_STORAGE);
  if (settings.claudeApiKey === "" && settings.githubToken === "") keep.removeItem(KEYS_STORAGE);
  else keep.setItem(KEYS_STORAGE, JSON.stringify({ claudeApiKey: settings.claudeApiKey, githubToken: settings.githubToken }));
}

/** Forgets keys and preferences in both storages. */
export function clearSettings(): void {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(KEYS_STORAGE);
    storage.removeItem(PREFS_STORAGE);
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
