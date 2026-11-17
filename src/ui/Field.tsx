import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./Field.module.css";

interface FieldFrameProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { inputId: string; hintId: string; invalid: boolean }) => ReactNode;
}

/** Label above, one line of hint or error below. Errors replace the hint and are announced. */
function FieldFrame({ label, hint, error = null, children }: FieldFrameProps) {
  const inputId = useId();
  const hintId = useId();
  const invalid = error !== null;
  return (
    <div className={invalid ? `${styles.field} ${styles.invalid}` : styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {children({ inputId, hintId, invalid })}
      {(invalid || hint !== undefined) && (
        <span className={styles.hint} id={hintId} role={invalid ? "alert" : undefined}>
          {invalid ? error : hint}
        </span>
      )}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | null;
  icon?: LucideIcon;
  /** Live detection result shown inside the field, e.g. "Pull request". */
  chip?: string | null;
}

export function TextField({ label, hint, error = null, icon: Icon, chip = null, ...input }: TextFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      {({ inputId, hintId, invalid }) => (
        <div className={styles.input}>
          {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
          <input {...input} id={inputId} aria-invalid={invalid || undefined} aria-describedby={hintId} />
          {chip !== null && <span className={styles.chip}>{chip}</span>}
        </div>
      )}
    </FieldFrame>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextAreaField({ label, hint, error = null, ...textarea }: TextAreaFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      {({ inputId, hintId, invalid }) => (
        <textarea
          {...textarea}
          className={`${styles.input} ${styles.textarea}`}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          spellCheck={false}
        />
      )}
    </FieldFrame>
  );
}
