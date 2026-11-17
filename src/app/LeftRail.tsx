import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight, FileCode2, Folder, MessageSquare, X } from "lucide-react";
import type { CodeNode } from "../model/types";
import { ancestry } from "../graph/view";
import { useAnalysis, useDispatch, useNavigation, useNoteCounts, useReview, useWorkspace } from "../state/workspace";
import { mustGet } from "../util/assert";
import { ChangeCount, KindGlyph, StatusBadge } from "../ui/Badges";
import { IconButton } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import styles from "./LeftRail.module.css";

export function LeftRail({ reviewEnabled, onClose }: { reviewEnabled: boolean; onClose: () => void }) {
  const { rail } = useWorkspace();
  const dispatch = useDispatch();
  const review = useReview();
  const showReview = reviewEnabled && review !== null;
  const tab = showReview ? rail : "outline";

  return (
    <nav className={styles.rail} aria-label="Files and review">
      <div className={styles.header}>
        {showReview ? (
          <SegmentedControl
            label="Left panel"
            value={tab}
            onChange={(value) => dispatch({ type: "setRail", rail: value })}
            segments={[
              { value: "outline", label: "Outline" },
              {
                value: "review",
                label: (
                  <>
                    Review <span className={styles.tabCount}>{review.items.length - review.viewedCount}</span>
                  </>
                ),
              },
            ]}
          />
        ) : (
          <span className="label">Files</span>
        )}
        <IconButton icon={X} label="Hide panel" onClick={onClose} className={styles.closeNarrow} />
      </div>
      <div className={styles.scroll}>{tab === "review" && review !== null ? <ReviewList /> : <OutlineTree />}</div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Outline

interface VisibleRow {
  node: CodeNode;
  depth: number;
  expandable: boolean;
}

function OutlineTree() {
  const analysis = useAnalysis();
  const { scopeId, selectedId } = useWorkspace();
  const navigation = useNavigation();
  const noteCounts = useNoteCounts();
  const { graph, changes } = analysis;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([graph.rootId]));

  // Keep the current location visible: expand every ancestor of the scope and the selection.
  useEffect(() => {
    const focusIds = [scopeId, selectedId].filter((id): id is string => id !== null && id !== "");
    setExpanded((current) => {
      const next = new Set(current);
      for (const id of focusIds) ancestry(graph, id).slice(0, -1).forEach((ancestorId) => next.add(ancestorId));
      return next;
    });
  }, [graph, scopeId, selectedId]);

  const rows = useMemo(() => visibleRows(graph.rootId, graph.nodes, expanded), [graph, expanded]);
  const currentId = selectedId ?? scopeId;

  const toggle = (nodeId: string, open: boolean): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const target = event.target as HTMLElement;
    const index = rows.findIndex((row) => row.node.id === target.dataset["id"]);
    const row = rows[index];
    if (row === undefined) return;
    const focusRow = (nextIndex: number): void => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, nextIndex))];
      if (next !== undefined) document.querySelector<HTMLElement>(`[data-tree-row][data-id="${CSS.escape(next.node.id)}"]`)?.focus();
    };
    const handled: Record<string, () => void> = {
      ArrowDown: () => focusRow(index + 1),
      ArrowUp: () => focusRow(index - 1),
      ArrowRight: () => (row.expandable && !expanded.has(row.node.id) ? toggle(row.node.id, true) : focusRow(index + 1)),
      ArrowLeft: () => {
        if (row.expandable && expanded.has(row.node.id)) toggle(row.node.id, false);
        else if (row.node.parentId !== null) focusRow(rows.findIndex((candidate) => candidate.node.id === row.node.parentId));
      },
      Enter: () => navigation.open(row.node.id),
      Home: () => focusRow(0),
      End: () => focusRow(rows.length - 1),
    };
    const action = handled[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  return (
    <ul className={styles.tree} role="tree" aria-label="Files" onKeyDown={onKeyDown}>
      {rows.map(({ node, depth, expandable }) => {
        const change = changes.get(node.id);
        const isOpen = expanded.has(node.id);
        const isCurrent = node.id === currentId;
        const notes = noteCounts.get(node.id) ?? 0;
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={expandable ? isOpen : undefined}
            aria-selected={isCurrent}
            tabIndex={isCurrent || (currentId === "" && depth === 0) ? 0 : -1}
            data-tree-row=""
            data-id={node.id}
            className={styles.row}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => navigation.open(node.id)}
          >
            <span
              className={styles.chevron}
              onClick={(event) => {
                event.stopPropagation();
                if (expandable) toggle(node.id, !isOpen);
              }}
            >
              {expandable && (isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />)}
            </span>
            <RowIcon node={node} />
            <span className={styles.rowLabel}>{rowLabel(node)}</span>
            <span className={styles.rowMeta}>
              {notes > 0 && node.kind !== "folder" && (
                <span className={styles.notes} aria-label={`${notes} notes`}>
                  <MessageSquare size={12} aria-hidden="true" />
                  {notes}
                </span>
              )}
              {change !== undefined && change.status !== null && node.kind === "symbol" && <span className={styles.dot} data-status={change.status} aria-label={change.status} />}
              {change !== undefined && change.status !== null && node.kind === "file" && <StatusBadge status={change.status} />}
              {change !== undefined && change.status === null && change.changedDescendants > 0 && <ChangeCount count={change.changedDescendants} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RowIcon({ node }: { node: CodeNode }) {
  if (node.symbol !== null) return <KindGlyph kind={node.symbol.kind} />;
  return node.kind === "folder" ? <Folder size={15} strokeWidth={1.75} aria-hidden="true" /> : <FileCode2 size={15} strokeWidth={1.75} aria-hidden="true" />;
}

function rowLabel(node: CodeNode): string {
  if (node.symbol === null) return node.label;
  return node.symbol.kind === "section" ? node.symbol.name : node.symbol.qualifiedName;
}

/** Depth-first list of rows under expanded nodes; the root itself is not shown. Blocks show to one level. */
function visibleRows(rootId: string, nodes: Map<string, CodeNode>, expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const visit = (nodeId: string, depth: number): void => {
    const node = mustGet(nodes, nodeId, "Tree node");
    const children = sortedChildren(node, nodes);
    const expandable = node.kind !== "symbol" && children.length > 0;
    rows.push({ node, depth, expandable });
    if (expandable && expanded.has(nodeId)) children.forEach((child) => visit(child.id, depth + 1));
  };
  sortedChildren(mustGet(nodes, rootId, "Root"), nodes).forEach((child) => visit(child.id, 0));
  return rows;
}

/** Folders first, then files, alphabetically; blocks keep source order. */
function sortedChildren(node: CodeNode, nodes: Map<string, CodeNode>): CodeNode[] {
  const children = node.childIds.map((id) => mustGet(nodes, id, "Child node"));
  if (node.kind === "file") return children.sort((a, b) => (a.symbol?.startLine ?? 0) - (b.symbol?.startLine ?? 0));
  return children.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "folder" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Review

function ReviewList() {
  const review = useReview();
  const { selectedId, viewed } = useWorkspace();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  if (review === null) throw new Error("ReviewList rendered without a diff");
  const { items, viewedCount } = review;
  const groups = groupByFile(items);

  return (
    <div className={styles.review}>
      <div className={styles.reviewHead}>
        <span className="label">Changed blocks</span>
        <span className="caption">
          {viewedCount} of {items.length} viewed
        </span>
      </div>
      <div className={styles.track} role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={viewedCount}>
        <span style={{ width: `${(viewedCount / items.length) * 100}%` }} />
      </div>
      {groups.map(([filePath, fileItems]) => (
        <section key={filePath} className={styles.group} aria-label={filePath}>
          <h3 className={styles.groupTitle} title={filePath}>
            {filePath}
          </h3>
          <ul className={styles.items}>
            {fileItems.map((item) => {
              const isViewed = viewed.has(item.nodeId);
              return (
                <li key={item.nodeId} className={styles.item} aria-current={item.nodeId === selectedId || undefined} data-viewed={isViewed || undefined}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isViewed}
                    aria-label={`Viewed: ${item.name}`}
                    className={styles.check}
                    onClick={() => dispatch({ type: "setViewed", nodeId: item.nodeId, viewed: !isViewed })}
                  >
                    {isViewed && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                  </button>
                  <button type="button" className={styles.itemName} onClick={() => navigation.open(item.nodeId)}>
                    <KindGlyph kind={item.kind} />
                    <span className={styles.itemLabel}>{item.name}</span>
                  </button>
                  <StatusBadge status={item.status} viewed={isViewed} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className={`caption ${styles.hint}`}>
        <kbd>N</kbd> next change · <kbd>V</kbd> mark viewed
      </p>
    </div>
  );
}

function groupByFile<T extends { filePath: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.filePath);
    if (group) group.push(item);
    else groups.set(item.filePath, [item]);
  }
  return [...groups];
}
