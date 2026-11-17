import { useState } from "react";
import { errorMessage } from "../../util/assert";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextAreaField } from "../../ui/Field";
import styles from "./dialogs.module.css";

interface DiffDialogProps {
  /** Resolves once the diff is applied; rejects with a message to show under the field. */
  onApply: (diffText: string) => Promise<void>;
  onClose: () => void;
}

/** Review a pasted diff on top of the loaded code (which should be the new version). */
export function DiffDialog({ onApply, onClose }: DiffDialogProps) {
  const [diffText, setDiffText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      title="Review a diff"
      description="Paste the output of git diff or a GitHub .diff. Its line numbers must match the code you loaded."
      width="wide"
      onClose={onClose}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          onApply(diffText)
            .catch((reason: unknown) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <TextAreaField
          label="Unified diff"
          rows={14}
          autoFocus
          value={diffText}
          error={error}
          placeholder={"diff --git a/src/app.ts b/src/app.ts\n@@ -10,6 +10,9 @@ …"}
          onChange={(event) => {
            setDiffText(event.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="primary" loading={busy} disabledReason={diffText.trim() === "" ? "Paste a diff first" : null}>
          Apply diff
        </Button>
      </form>
    </Dialog>
  );
}
