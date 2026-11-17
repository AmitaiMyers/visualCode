import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import styles from "./Dialog.module.css";

interface DialogProps {
  title: string;
  description?: string;
  width?: "narrow" | "wide";
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal built on the native <dialog>: the browser provides the focus trap, Esc, the inert
 * background and returning focus to the opener.
 */
export function Dialog({ title, description, width = "narrow", onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) throw new Error("Dialog element missing");
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[width]}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // let React own closing so state and DOM stay in sync
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(); // click on the backdrop
      }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description !== undefined && <p className={styles.description}>{description}</p>}
          </div>
          <IconButton icon={X} label="Close" shortcut="Esc" onClick={onClose} />
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
