import { useState } from "react";
import type { Project } from "../model/types";
import { loadFromGitHub } from "../ingest/github";
import { loadFromFolder, loadFromPaste, loadFromZip } from "../ingest/localFiles";

type Tab = "github" | "local" | "paste";

interface LoadDialogProps {
  githubToken: string;
  onLoad: (label: string, load: (onProgress: (message: string) => void) => Promise<Project>) => void;
  onClose: () => void;
}

export function LoadDialog({ githubToken, onLoad, onClose }: LoadDialogProps) {
  const [tab, setTab] = useState<Tab>("github");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("snippet.ts");
  const [code, setCode] = useState("");
  const [diffText, setDiffText] = useState("");

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="load-title" onClick={(event) => event.stopPropagation()}>
        <header className="dialog__header">
          <h2 id="load-title">Load code</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="tabs" role="tablist">
          {(["github", "local", "paste"] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? "tab is-active" : "tab"} onClick={() => setTab(name)}>
              {name === "github" ? "GitHub URL" : name === "local" ? "Folder / zip" : "Paste"}
            </button>
          ))}
        </div>

        {tab === "github" && (
          <form
            className="dialog__body"
            onSubmit={(event) => {
              event.preventDefault();
              onLoad("Loading from GitHub…", (progress) => loadFromGitHub(url, githubToken, progress));
            }}
          >
            <label className="field">
              <span>Public repository, folder or pull request URL</span>
              <input
                type="url"
                required
                placeholder="https://github.com/owner/repo/pull/123"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <p className="muted">
              Works with <code>github.com/owner/repo</code>, <code>…/tree/branch/folder</code> and <code>…/pull/123</code>. A pull
              request loads the code at its head with the changes highlighted.
            </p>
            <button className="primary-button" type="submit">
              Load
            </button>
          </form>
        )}

        {tab === "local" && (
          <div className="dialog__body">
            <label className="field">
              <span>Pick a project folder</span>
              <input
                type="file"
                // @ts-expect-error webkitdirectory is supported by all major browsers but missing from React's types
                webkitdirectory=""
                multiple
                onChange={(event) => {
                  const files = event.target.files;
                  if (files !== null && files.length > 0) onLoad("Reading folder…", () => loadFromFolder(files));
                }}
              />
            </label>
            <label className="field">
              <span>…or a .zip archive</span>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.item(0);
                  if (file) onLoad("Unpacking zip…", async () => loadFromZip(file));
                }}
              />
            </label>
            <p className="muted">Files stay on this device. node_modules, build output and virtual envs are skipped.</p>
          </div>
        )}

        {tab === "paste" && (
          <form
            className="dialog__body"
            onSubmit={(event) => {
              event.preventDefault();
              onLoad("Reading pasted code…", async () => loadFromPaste(fileName, code, diffText));
            }}
          >
            <label className="field">
              <span>File name (sets the language)</span>
              <input value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="app.py" />
            </label>
            <label className="field">
              <span>Code</span>
              <textarea className="code-input" rows={10} value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} />
            </label>
            <label className="field">
              <span>Unified diff (optional, e.g. output of git diff)</span>
              <textarea className="code-input" rows={6} value={diffText} onChange={(event) => setDiffText(event.target.value)} spellCheck={false} />
            </label>
            <button className="primary-button" type="submit">
              Load
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
