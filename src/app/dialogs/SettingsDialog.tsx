import { useState } from "react";
import { KeyRound, Monitor, Moon, Sun } from "lucide-react";
import type { Settings, ThemePreference } from "../../settings";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextField } from "../../ui/Field";
import { SegmentedControl } from "../../ui/SegmentedControl";
import styles from "./dialogs.module.css";

interface SettingsDialogProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const update = (patch: Partial<Settings>): void => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <section className={styles.group} aria-label="Appearance">
          <span className="label">Appearance</span>
          <SegmentedControl<ThemePreference>
            label="Theme"
            value={draft.theme}
            onChange={(theme) => update({ theme })}
            segments={[
              { value: "system", label: <><Monitor size={14} aria-hidden="true" /> System</> },
              { value: "light", label: <><Sun size={14} aria-hidden="true" /> Light</> },
              { value: "dark", label: <><Moon size={14} aria-hidden="true" /> Dark</> },
            ]}
          />
        </section>

        <section className={styles.group} aria-label="Review">
          <span className="label">Review</span>
          <label className={styles.switch}>
            <input type="checkbox" checked={draft.reviewChecklist} onChange={(event) => update({ reviewChecklist: event.target.checked })} />
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>Review checklist</span>
              <span className="caption">The Review tab, "Mark viewed" and the progress counter. Turn off to read code without tracking review progress.</span>
            </span>
          </label>
        </section>

        <section className={styles.group} aria-label="Keys">
          <span className="label">Keys</span>
          <TextField
            label="Claude API key"
            icon={KeyRound}
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            hint="Enables Explain and Suggest review notes. Sent only to api.anthropic.com, from your browser."
            value={draft.claudeApiKey}
            onChange={(event) => update({ claudeApiKey: event.target.value.trim() })}
          />
          <TextField
            label="GitHub token"
            icon={KeyRound}
            type="password"
            autoComplete="off"
            placeholder="github_pat_…"
            hint="Optional. Raises GitHub's rate limit for loading repositories."
            value={draft.githubToken}
            onChange={(event) => update({ githubToken: event.target.value.trim() })}
          />
          <label className={styles.switch}>
            <input type="checkbox" checked={draft.rememberKeys} onChange={(event) => update({ rememberKeys: event.target.checked })} />
            <span className={styles.switchText}>
              <span className={styles.switchTitle}>Remember keys on this device</span>
              <span className="caption">Stored unencrypted in this browser. Use keys with spending limits.</span>
            </span>
          </label>
        </section>

        <div className={styles.row}>
          <Button type="submit" variant="primary">
            Save settings
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
