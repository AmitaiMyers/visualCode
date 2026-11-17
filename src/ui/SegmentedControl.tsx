import { useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./SegmentedControl.module.css";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  disabledReason?: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Two or three mutually exclusive views (Map | Story, Outline | Review). Arrow keys move between segments. */
export function SegmentedControl<T extends string>({ label, segments, value, onChange }: SegmentedControlProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const enabled = segments.filter((segment) => segment.disabledReason === undefined);
    const index = enabled.findIndex((segment) => segment.value === value);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (next === undefined) return;
    onChange(next.value);
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
    button?.focus();
  };

  return (
    <div ref={listRef} className={styles.track} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {segments.map((segment) => {
        const selected = segment.value === value;
        const disabled = segment.disabledReason !== undefined;
        return (
          <button
            key={segment.value}
            type="button"
            role="tab"
            data-value={segment.value}
            aria-selected={selected}
            aria-disabled={disabled || undefined}
            tabIndex={selected ? 0 : -1}
            data-tooltip={segment.disabledReason}
            className={styles.segment}
            onClick={() => {
              if (!disabled) onChange(segment.value);
            }}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
