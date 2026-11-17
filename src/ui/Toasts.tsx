import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import styles from "./Toasts.module.css";

export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastInput {
  message: string;
  tone?: "success" | "error" | "neutral";
  action?: ToastAction;
}

interface Toast extends Required<Omit<ToastInput, "action">> {
  id: number;
  action: ToastAction | null;
}

const DEFAULT_MS = 4000;
const WITH_ACTION_MS = 6000;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Shows short confirmations at the bottom centre; announced politely, never steals focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const show = useCallback((input: ToastInput) => {
    const toast: Toast = {
      id: nextId.current++,
      message: input.message,
      tone: input.tone ?? "neutral",
      action: input.action ?? null,
    };
    setToasts((current) => [...current.slice(-2), toast]); // at most three on screen
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.action === null ? DEFAULT_MS : WITH_ACTION_MS);
    return () => window.clearTimeout(timer);
  }, [paused, toast, onDismiss]);

  const Icon = toast.tone === "error" ? CircleAlert : Check;
  return (
    <div className={styles.toast} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {toast.tone !== "neutral" && <Icon size={16} strokeWidth={2} aria-hidden="true" className={styles[toast.tone]} />}
      <span className={styles.message}>{toast.message}</span>
      {toast.action !== null && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.run();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (show === null) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
