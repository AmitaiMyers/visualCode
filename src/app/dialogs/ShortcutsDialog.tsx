import { Dialog } from "../../ui/Dialog";
import { Kbd } from "../../ui/Badges";
import { SHORTCUT_GROUPS } from "../shortcuts";
import styles from "./dialogs.module.css";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" description="Every shortcut also has a button. None fire while you type." width="wide" onClose={onClose}>
      <div className={styles.shortcuts}>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className={styles.group} aria-label={group.title}>
            <span className="label">{group.title}</span>
            <dl className={styles.shortcutList}>
              {group.items.map((item) => (
                <div key={item.action} className={styles.shortcutRow}>
                  <dt>
                    {item.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dt>
                  <dd>{item.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
