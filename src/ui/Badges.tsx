import { Check } from "lucide-react";
import type { ChangeStatus, NodeKind, SymbolKind } from "../model/types";
import styles from "./Badges.module.css";

const STATUS_TEXT: Record<ChangeStatus, { glyph: string; word: string }> = {
  added: { glyph: "+", word: "added" },
  modified: { glyph: "~", word: "changed" },
  deleted: { glyph: "−", word: "deleted" },
  renamed: { glyph: "→", word: "renamed" },
};

/** Change status: always a glyph plus a word, never colour alone. A viewed block shows "viewed" instead. */
export function StatusBadge({ status, viewed = false }: { status: ChangeStatus; viewed?: boolean }) {
  if (viewed) {
    return (
      <span className={`${styles.status} ${styles.viewed}`}>
        <Check size={12} strokeWidth={2.25} aria-hidden="true" />
        viewed
      </span>
    );
  }
  const { glyph, word } = STATUS_TEXT[status];
  return (
    <span className={`${styles.status} ${styles[status]}`}>
      <b aria-hidden="true">{glyph}</b>
      {word}
    </span>
  );
}

export function statusWord(status: ChangeStatus): string {
  return STATUS_TEXT[status].word;
}

/** Reading-order number on a block. */
export function StepBadge({ step, variant = "filled" }: { step: number; variant?: "filled" | "outline" | "done" }) {
  return (
    <span className={`${styles.step} ${styles[variant]}`} aria-hidden="true">
      {step}
    </span>
  );
}

/** "~3" style count of changes inside a folder or file. */
export function ChangeCount({ count }: { count: number }) {
  return (
    <span className={styles.count} aria-label={`${count} changed`}>
      ~{count}
    </span>
  );
}

const KIND_GLYPHS: Record<SymbolKind | NodeKind, string> = {
  function: "ƒ",
  method: "ƒ·",
  class: "◇",
  section: "§",
  folder: "▸",
  file: "▤",
  symbol: "◆",
};

const KIND_WORDS: Record<SymbolKind, string> = {
  function: "function",
  method: "method",
  class: "class",
  section: "section",
};

/** Typographic glyph for a block kind (ƒ function, ◇ class, § section). */
export function KindGlyph({ kind }: { kind: SymbolKind | NodeKind }) {
  return (
    <span className={styles.kind} aria-hidden="true">
      {KIND_GLYPHS[kind]}
    </span>
  );
}

export function kindWord(kind: SymbolKind): string {
  return KIND_WORDS[kind];
}

export function Kbd({ children }: { children: string }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
