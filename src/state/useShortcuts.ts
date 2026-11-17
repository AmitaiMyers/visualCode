import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts. Keys are written like "j", "shift+n", "mod+k" (mod = Cmd on macOS, Ctrl elsewhere),
 * "escape", "?". Shortcuts never fire while typing in a field or while a modal dialog is open,
 * except "mod+k", which opens search from anywhere.
 */
export function useShortcuts(bindings: Record<string, () => void>, enabled = true): void {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const combo = comboOf(event);
      const handler = latest.current[combo];
      if (handler === undefined) return;
      const global = combo === "mod+k";
      if (!global && (isTyping(event.target) || document.querySelector("dialog[open]") !== null)) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

function comboOf(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  if (key === "?") return "?"; // shift is implied by the character
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Platform-aware label for the mod key. */
export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
