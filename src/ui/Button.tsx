import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
  /** When set, the button is disabled and this text explains how to enable it (shown as a tooltip). */
  disabledReason?: string | null;
  children: ReactNode;
}

/**
 * The one button. Disabled buttons stay focusable (aria-disabled) so their tooltip can explain why;
 * loading keeps the label and width and swaps the icon for a spinner.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading = false,
  disabledReason = null,
  children,
  className,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabledReason !== null;
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      data-tooltip={isDisabled ? disabledReason : undefined}
      onClick={(event) => {
        if (isDisabled || loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  tooltipSide?: "top" | "bottom";
}

/** Square icon-only button; its label doubles as the tooltip, with the shortcut appended. */
export function IconButton({ icon: Icon, label, shortcut, pressed, tooltipSide = "bottom", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={[styles.iconButton, className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      data-tooltip-side={tooltipSide === "top" ? "top" : undefined}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
