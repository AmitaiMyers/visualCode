import { useState } from "react";
import type { Settings } from "../settings";

interface SettingsDialogProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <header className="dialog__header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="dialog__body">
          <label className="field">
            <span>Claude API key (optional, enables Explain and Suggest review notes)</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={draft.claudeApiKey}
              onChange={(event) => setDraft({ ...draft, claudeApiKey: event.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span>GitHub token (optional, raises the API rate limit)</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={draft.githubToken}
              onChange={(event) => setDraft({ ...draft, githubToken: event.target.value.trim() })}
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.remember} onChange={(event) => setDraft({ ...draft, remember: event.target.checked })} />
            <span>Remember keys on this device (stored unencrypted in this browser)</span>
          </label>
          <p className="muted">
            Keys are sent only to api.anthropic.com and api.github.com, directly from your browser. Use a key with a spending limit.
          </p>
          <button className="primary-button" type="submit">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
