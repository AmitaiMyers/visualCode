import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, FileCode2, Folder, Search, Zap } from "lucide-react";
import type { CodeGraph } from "../model/types";
import { openNode, useDispatch, useWorkspace } from "../state/workspace";
import { KindGlyph } from "../ui/Badges";
import styles from "./CommandPalette.module.css";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

interface Item {
  id: string;
  group: "Blocks" | "Files" | "Commands";
  name: string;
  detail: string;
  icon: ReactNode;
  run: () => void;
}

const MAX_RESULTS = 40;

/** ⌘K search over blocks, files and commands. Arrow keys move, Enter runs, Esc closes. */
export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const { analysis } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) throw new Error("Palette dialog missing");
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const allItems = useCodeItems(analysis === null ? null : analysis.graph, onClose);
  const commandItems: Item[] = commands.map((command) => ({
    id: `cmd:${command.id}`,
    group: "Commands",
    name: command.label,
    detail: command.shortcut ?? "",
    icon: <Zap size={15} aria-hidden="true" />,
    run: () => {
      onClose();
      command.run();
    },
  }));

  const results = useMemo(() => search([...allItems, ...commandItems], query), [allItems, commandItems, query]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const activeItem = results[activeIndex];

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + results.length) % Math.max(1, results.length));
    } else if (event.key === "Enter" && activeItem !== undefined) {
      event.preventDefault();
      activeItem.item.run();
    }
  };

  useEffect(() => {
    document.getElementById(`palette-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let lastGroup: string | null = null;
  return (
    <dialog
      ref={dialogRef}
      className={styles.palette}
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.searchRow}>
        <Search size={18} aria-hidden="true" />
        <input
          autoFocus
          className={styles.input}
          placeholder={analysis === null ? "Search commands…" : "Search blocks, files and commands…"}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={activeItem === undefined ? undefined : `palette-${activeIndex}`}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul className={styles.results} id="palette-results" role="listbox" aria-label="Results">
        {results.length === 0 && <li className={styles.empty}>Nothing matches “{query}”.</li>}
        {results.map(({ item, matches }, index) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <li key={item.id} role="presentation">
              {header !== null && <div className={`label ${styles.groupLabel}`}>{header}</div>}
              <div
                id={`palette-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={styles.option}
                onMouseMove={() => setActive(index)}
                onClick={() => item.run()}
              >
                <span className={styles.icon}>{item.icon}</span>
                <span className={styles.name}>{highlight(item.name, matches)}</span>
                <span className={styles.detail}>{item.detail}</span>
                {index === activeIndex && <CornerDownLeft size={14} className={styles.enter} aria-hidden="true" />}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}

function useCodeItems(graph: CodeGraph | null, onClose: () => void): Item[] {
  const dispatch = useDispatch();
  return useMemo(() => {
    if (graph === null) return [];
    const items: Item[] = [];
    for (const node of graph.nodes.values()) {
      const open = (): void => {
        onClose();
        openNode(graph, dispatch, node.id);
      };
      if (node.symbol !== null) {
        const name = node.symbol.kind === "section" ? `${node.symbol.name} · ${node.label}` : node.symbol.qualifiedName;
        items.push({ id: node.id, group: "Blocks", name, detail: node.path, icon: <KindGlyph kind={node.symbol.kind} />, run: open });
      } else if (node.kind === "file") {
        items.push({ id: node.id, group: "Files", name: node.label, detail: node.path, icon: <FileCode2 size={15} aria-hidden="true" />, run: open });
      } else if (node.path !== "") {
        items.push({ id: node.id, group: "Files", name: `${node.label}/`, detail: node.path, icon: <Folder size={15} aria-hidden="true" />, run: open });
      }
    }
    return items;
  }, [graph, dispatch, onClose]);
}

interface Result {
  item: Item;
  matches: number[]; // indexes of matched characters in item.name
}

/**
 * Subsequence match on the name (then the detail), scored so that contiguous matches and
 * matches at word starts win. Empty query lists commands first.
 */
function search(items: Item[], query: string): Result[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return [...items.filter((item) => item.group === "Commands"), ...items.filter((item) => item.group !== "Commands").slice(0, 12)].map((item) => ({ item, matches: [] }));
  }
  const scored: { result: Result; score: number }[] = [];
  for (const item of items) {
    const nameMatch = match(item.name, q);
    const detailMatch = nameMatch === null ? match(item.detail, q) : null;
    if (nameMatch === null && detailMatch === null) continue;
    const score = nameMatch !== null ? nameMatch.score + 100 : (detailMatch?.score ?? 0);
    scored.push({ result: { item, matches: nameMatch === null ? [] : nameMatch.indexes }, score });
  }
  const groupRank = { Blocks: 0, Files: 1, Commands: 2 } as const;
  return scored
    .sort((a, b) => b.score - a.score || groupRank[a.result.item.group] - groupRank[b.result.item.group])
    .slice(0, MAX_RESULTS)
    .sort((a, b) => groupRank[a.result.item.group] - groupRank[b.result.item.group] || b.score - a.score)
    .map(({ result }) => result);
}

function match(text: string, query: string): { score: number; indexes: number[] } | null {
  const lower = text.toLowerCase();
  const indexes: number[] = [];
  let from = 0;
  let score = 0;
  for (const char of query) {
    const index = lower.indexOf(char, from);
    if (index === -1) return null;
    const previous = indexes[indexes.length - 1];
    if (previous !== undefined && index === previous + 1) score += 5; // contiguous
    if (index === 0 || /[^a-z0-9]/i.test(lower.charAt(index - 1)) || (text.charAt(index) !== lower.charAt(index))) score += 3; // word start
    indexes.push(index);
    from = index + 1;
  }
  return { score: score - text.length * 0.01, indexes };
}

function highlight(text: string, indexes: number[]): ReactNode {
  if (indexes.length === 0) return text;
  const marked = new Set(indexes);
  return [...text].map((char, index) => (marked.has(index) ? <mark key={index}>{char}</mark> : char));
}
