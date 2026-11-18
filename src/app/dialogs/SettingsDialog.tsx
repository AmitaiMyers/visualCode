import { useState } from "react";
import { errorMessage } from "../../util/assert";
import { KeyRound, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import type { KeyStorage, Settings, ThemePreference } from "../../settings";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextField } from "../../ui/Field";
import { SegmentedControl } from "../../ui/SegmentedControl";
import styles from "./dialogs.module.css";

interface SettingsDialogProps {
  settings: Settings;
  projectTitle: string | null; // the open project, whose data "Clear this project's data" deletes
  onSave: (settings: Settings) => void;
  onClearProject: () => Promise<void>;
  onClearAll: () => Promise<void>;
  onClose: () => void;
}

export function SettingsDialog({ settings, projectTitle, onSave, onClearProject, onClearAll, onClose }: SettingsDialogProps) {
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
          <span className={styles.switchTitle}>Keep keys</span>
          <SegmentedControl<KeyStorage>
            label="Keep keys"
            value={draft.keyStorage}
            onChange={(keyStorage) => update({ keyStorage })}
            segments={[
              { value: "tab", label: "Until this tab closes" },
              { value: "device", label: "On this device" },
            ]}
          />
          <p className="caption">
            Keys are stored unencrypted, and other pages on this site's address can read them. Keep them in this tab unless you trust
            this device, and use a read-only GitHub token and a Claude key with a spending limit.
          </p>
        </section>

        <section className={styles.group} aria-label="Data in this browser">
          <span className="label">Data in this browser</span>
          <p className="caption">
            Loaded code is never stored or uploaded. Notes, viewed marks, system design edits and AI permissions are kept in this
            browser until you clear them.
          </p>
          <div className={styles.row}>
            {projectTitle !== null && <ClearButton label="Clear this project's data" onConfirm={onClearProject} />}
            <ClearButton label="Clear everything" onConfirm={onClearAll} />
          </div>
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

/** A destructive button that asks for a second click before it acts. On success the dialog closes. */
function ClearButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [state, setState] = useState<{ step: "idle" | "armed" | "working" } | { step: "failed"; message: string }>({ step: "idle" });
  const text = { idle: label, armed: "Click again to delete", working: "Deleting…", failed: label }[state.step];
  return (
    <span>
      <Button
        variant={state.step === "armed" ? "danger" : "secondary"}
        size="sm"
        icon={Trash2}
        loading={state.step === "working"}
        onClick={() => {
          if (state.step !== "armed") {
            setState({ step: "armed" });
            return;
          }
          setState({ step: "working" });
          onConfirm().catch((reason: unknown) => setState({ step: "failed", message: errorMessage(reason) }));
        }}
        onBlur={() => setState((current) => (current.step === "armed" ? { step: "idle" } : current))}
      >
        {text}
      </Button>
      {state.step === "failed" && (
        <span className="caption" role="alert">
          {state.message}
        </span>
      )}
    </span>
  );
}
