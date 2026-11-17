import { useState } from "react";

interface DiffDialogProps {
  onApply: (diffText: string) => void;
  onClose: () => void;
}

/** Paste a unified diff to review on top of the loaded code (which should be the new version). */
export function DiffDialog({ onApply, onClose }: DiffDialogProps) {
  const [diffText, setDiffText] = useState("");
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onApply(diffText);
        }}
      >
        <header className="dialog__header">
          <h2 id="diff-title">Review a diff</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="dialog__body">
          <label className="field">
            <span>Unified diff (git diff, or a GitHub .diff). Line numbers must match the loaded code's new version.</span>
            <textarea className="code-input" rows={14} value={diffText} onChange={(event) => setDiffText(event.target.value)} spellCheck={false} />
          </label>
          <button className="primary-button" type="submit" disabled={diffText.trim() === ""}>
            Apply diff
          </button>
        </div>
      </form>
    </div>
  );
}
