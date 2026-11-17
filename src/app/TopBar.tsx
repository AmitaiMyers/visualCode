import { Download, Keyboard, PanelLeft, Search, Settings, Upload } from "lucide-react";
import { MOD_KEY } from "../state/useShortcuts";
import { useReview, useWorkspace } from "../state/workspace";
import { Button, IconButton } from "../ui/Button";
import { Kbd } from "../ui/Badges";
import { Logo } from "../ui/Logo";
import styles from "./TopBar.module.css";

interface TopBarProps {
  railOpen: boolean;
  reviewEnabled: boolean;
  onToggleRail: () => void;
  onLoad: () => void;
  onSearch: () => void;
  onExport: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
}

export function TopBar(props: TopBarProps) {
  const { analysis } = useWorkspace();
  const review = useReview();
  const loaded = analysis !== null;
  return (
    <header className={styles.bar}>
      {loaded && <IconButton icon={PanelLeft} label={props.railOpen ? "Hide files" : "Show files"} pressed={props.railOpen} onClick={props.onToggleRail} />}
      <Logo showName />
      {loaded && (
        <>
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.project} title={analysis.project.title}>
            {analysis.project.title}
          </span>
        </>
      )}
      <div className={styles.spacer} />
      <button type="button" className={styles.search} onClick={props.onSearch} aria-label="Search files, blocks and commands">
        <Search size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.searchText}>Search</span>
        <span className={styles.searchKeys} aria-hidden="true">
          <Kbd>{MOD_KEY}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      {props.reviewEnabled && review !== null && <ReviewProgress viewed={review.viewedCount} total={review.items.length} />}
      <div className={styles.actions}>
        {loaded && (
          <Button variant="ghost" icon={Download} onClick={props.onExport} className={styles.hideNarrow}>
            Export review
          </Button>
        )}
        <Button variant={loaded ? "secondary" : "primary"} icon={Upload} onClick={props.onLoad}>
          Load code
        </Button>
        <IconButton icon={Keyboard} label="Keyboard shortcuts" shortcut="?" onClick={props.onShortcuts} className={styles.hidePhone} />
        <IconButton icon={Settings} label="Settings" onClick={props.onSettings} />
      </div>
    </header>
  );
}

function ReviewProgress({ viewed, total }: { viewed: number; total: number }) {
  const done = viewed === total;
  return (
    <div className={styles.progress} title="Changed blocks you marked viewed">
      <span className={styles.progressText}>
        <strong>{viewed}</strong> of {total} viewed
      </span>
      <span
        className={styles.progressTrack}
        role="progressbar"
        aria-label="Review progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={viewed}
      >
        <span className={done ? `${styles.progressFill} ${styles.done}` : styles.progressFill} style={{ width: `${(viewed / total) * 100}%` }} />
      </span>
    </div>
  );
}
