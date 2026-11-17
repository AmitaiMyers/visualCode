import styles from "./Logo.module.css";

/** Product mark: three blocks joined by an ink flow line, drawn from the ink, added and modified tokens. */
export function Logo({ showName = true }: { showName?: boolean }) {
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true">
        <path className={styles.flow} d="M7 7.5 C 12 7.5, 9 16.5, 15.5 16.5" />
        <rect className={styles.ink} x="2" y="3" width="8" height="9" rx="2.5" />
        <rect className={styles.added} x="15" y="3" width="7" height="6" rx="2" />
        <rect className={styles.modified} x="14" y="13" width="8" height="8" rx="2.5" />
      </svg>
      {showName && <span className={styles.name}>VisualCode</span>}
    </span>
  );
}
