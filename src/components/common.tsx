import type { ChangeStatus, NodeKind, SymbolKind } from "../model/types";

export const KIND_ICONS: Record<NodeKind | SymbolKind, string> = {
  folder: "📁",
  file: "📄",
  symbol: "◆",
  class: "◇",
  function: "ƒ",
  method: "ƒ",
  section: "§",
};

const STATUS_LABELS: Record<ChangeStatus, string> = {
  added: "added",
  modified: "changed",
  deleted: "deleted",
  renamed: "renamed",
};

export function StatusPill({ status }: { status: ChangeStatus | null }) {
  if (status === null) return null;
  return <span className={`status-pill status-pill--${status}`}>{STATUS_LABELS[status]}</span>;
}
