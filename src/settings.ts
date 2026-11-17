// User settings. Keys live in memory unless the user opts in to remembering them.

export interface Settings {
  claudeApiKey: string;
  githubToken: string;
  remember: boolean;
}

const STORAGE_KEY = "visualcode:settings";

const EMPTY_SETTINGS: Settings = { claudeApiKey: "", githubToken: "", remember: false };

export function loadSettings(): Settings {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return EMPTY_SETTINGS;
  const parsed = JSON.parse(stored) as Partial<Settings>;
  return {
    claudeApiKey: typeof parsed.claudeApiKey === "string" ? parsed.claudeApiKey : "",
    githubToken: typeof parsed.githubToken === "string" ? parsed.githubToken : "",
    remember: true,
  };
}

export function persistSettings(settings: Settings): void {
  if (settings.remember) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
