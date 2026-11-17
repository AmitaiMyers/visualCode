import { MOD_KEY } from "../state/useShortcuts";

/** Every shortcut, as shown in the "?" dialog. Each has a visible button equivalent in the UI. */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; action: string }[] }[] = [
  {
    title: "Anywhere",
    items: [
      { keys: [MOD_KEY, "K"], action: "Search files, blocks and commands" },
      { keys: ["?"], action: "Show keyboard shortcuts" },
      { keys: ["Esc"], action: "Close the panel or dialog, otherwise go up one level" },
      { keys: ["M"], action: "Switch between Map and Story" },
    ],
  },
  {
    title: "Reading",
    items: [
      { keys: ["J"], action: "Next step in the storyline" },
      { keys: ["K"], action: "Previous step in the storyline" },
      { keys: ["F"], action: "Fit the canvas to the content" },
      { keys: ["Enter"], action: "Open the selected folder or file, or expand a selected reference" },
    ],
  },
  {
    title: "Reviewing",
    items: [
      { keys: ["N"], action: "Next changed block" },
      { keys: ["Shift", "N"], action: "Previous changed block" },
      { keys: ["V"], action: "Mark the selected block viewed" },
      { keys: ["C"], action: "Write a note on the selected block" },
    ],
  },
];
