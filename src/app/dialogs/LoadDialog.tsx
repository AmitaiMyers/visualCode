import { useState } from "react";
import { FileArchive, FolderOpen, Link2 } from "lucide-react";
import { loadFromGitHub } from "../../ingest/github";
import { entriesFromFileList, loadFromEntries, loadFromPaste, loadFromZip } from "../../ingest/localFiles";
import { errorMessage } from "../../util/assert";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextAreaField, TextField } from "../../ui/Field";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type { ProjectSource } from "../useProjectLoader";
import styles from "./dialogs.module.css";

export type LoadTab = "github" | "local" | "paste";

interface LoadDialogProps {
  initialTab: LoadTab;
  githubToken: string;
  /** Resolves when the project is open; rejects with a message to show in the dialog. */
  onOpen: (source: ProjectSource) => Promise<void>;
  onClose: () => void;
}

/** Load code from GitHub, a local folder/zip, or pasted text. Errors stay in the dialog with the input intact. */
export function LoadDialog({ initialTab, githubToken, onOpen, onClose }: LoadDialogProps) {
  const [tab, setTab] = useState<LoadTab>(initialTab);
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("snippet.ts");
  const [code, setCode] = useState("");
  const [diffText, setDiffText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (source: ProjectSource): void => {
    setBusy(true);
    setError(null);
    onOpen(source)
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog title="Load code" description="Everything is read in your browser. Nothing is uploaded." onClose={onClose}>
      <SegmentedControl
        label="Source"
        value={tab}
        onChange={(value) => {
          setTab(value);
          setError(null);
        }}
        segments={[
          { value: "github", label: "GitHub" },
          { value: "local", label: "Folder or zip" },
          { value: "paste", label: "Paste" },
        ]}
      />

      {tab === "github" && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            open((progress) => loadFromGitHub(url, githubToken, progress));
          }}
        >
          <TextField
            label="Repository, folder or pull request"
            icon={Link2}
            placeholder="github.com/owner/repo/pull/42"
            value={url}
            autoFocus
            error={error}
            hint="Public repositories only. A pull request opens with its changes highlighted."
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
          />
          <Button type="submit" variant="primary" loading={busy} disabledReason={url.trim() === "" ? "Paste a GitHub link first" : null}>
            Open
          </Button>
        </form>
      )}

      {tab === "local" && (
        <div className={styles.form}>
          <div className={styles.pickers}>
            <label className={styles.picker}>
              <FolderOpen size={20} aria-hidden="true" />
              <span className={styles.pickerTitle}>Choose a folder</span>
              <span className="caption">node_modules, build output and virtual envs are skipped.</span>
              <input
                type="file"
                className="visually-hidden"
                // @ts-expect-error webkitdirectory is supported by all major browsers but missing from React's types
                webkitdirectory=""
                multiple
                onChange={(event) => {
                  const files = event.target.files;
                  if (files !== null && files.length > 0) open(async () => loadFromEntries(entriesFromFileList(files)));
                }}
              />
            </label>
            <label className={styles.picker}>
              <FileArchive size={20} aria-hidden="true" />
              <span className={styles.pickerTitle}>Choose a .zip</span>
              <span className="caption">For example a repository downloaded from GitHub.</span>
              <input
                type="file"
                className="visually-hidden"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.item(0);
                  if (file) open(() => loadFromZip(file));
                }}
              />
            </label>
          </div>
          {busy && <p className="caption">Reading files…</p>}
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <p className="caption">You can also drop a folder or .zip anywhere on the window.</p>
        </div>
      )}

      {tab === "paste" && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            open(async () => loadFromPaste(fileName, code, diffText));
          }}
        >
          <TextField label="File name" hint="The extension sets the language: .ts, .py, .java, .go, .rs, .cs…" value={fileName} onChange={(event) => setFileName(event.target.value)} />
          <TextAreaField label="Code" rows={9} value={code} placeholder="Paste a file here" onChange={(event) => setCode(event.target.value)} />
          <TextAreaField
            label="Diff (optional)"
            rows={5}
            value={diffText}
            placeholder="Output of git diff, or a GitHub .diff"
            error={error}
            onChange={(event) => setDiffText(event.target.value)}
          />
          <Button type="submit" variant="primary" loading={busy} disabledReason={code.trim() === "" && diffText.trim() === "" ? "Paste some code or a diff first" : null}>
            Open
          </Button>
        </form>
      )}
    </Dialog>
  );
}
