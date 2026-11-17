import type { ChangeStatus, FileDiff, RemovedLine } from "../model/types";
import { at } from "../util/assert";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface HunkSummary {
  addedLines: number[];
  removalAnchors: number[];
  removedBefore: Record<number, RemovedLine[]>;
  addedCount: number;
  removedCount: number;
}

interface Hunk {
  oldStart: number; // first old-file line the hunk covers (for an empty old side: the line it comes before)
  newStart: number; // first new-file line the hunk covers (for an empty new side: the line it comes before)
  lines: string[]; // raw " ", "+", "-" lines
}

/** Splits a patch into hunks. Lines outside hunks and "\ No newline" markers are dropped. */
function readHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      // "+5,0" means "after line 5": the removed lines sit before line 6 (likewise "-5,0" for added lines).
      current = { oldStart: sideStart(at(header, 1, "hunk old start"), header[2]), newStart: sideStart(at(header, 3, "hunk new start"), header[4]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (current !== null && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
      current.lines.push(line);
    }
  }
  return hunks;
}

function sideStart(start: string, count: string | undefined): number {
  return count === "0" ? Number(start) + 1 : Number(start);
}

/**
 * Reads the hunks of one file's patch (the part starting at the first "@@").
 * Line numbers refer to the new version of the file; removed lines are keyed by the new line they sit above.
 */
export function summarizeHunks(patch: string): HunkSummary {
  const summary: HunkSummary = { addedLines: [], removalAnchors: [], removedBefore: {}, addedCount: 0, removedCount: 0 };
  for (const hunk of readHunks(patch)) {
    let newLine = hunk.newStart;
    let oldLine = hunk.oldStart;
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        summary.addedLines.push(newLine);
        summary.addedCount += 1;
        newLine += 1;
      } else if (line.startsWith("-")) {
        const anchor = Math.max(1, newLine);
        if (summary.removedBefore[anchor] === undefined) summary.removedBefore[anchor] = [];
        summary.removedBefore[anchor].push({ oldLine, text: line.slice(1) });
        summary.removedCount += 1;
        oldLine += 1;
      } else {
        newLine += 1;
        oldLine += 1;
      }
    }
  }
  summary.removalAnchors = Object.keys(summary.removedBefore).map(Number);
  return summary;
}

/**
 * Rebuilds the old version of a file by applying its patch in reverse to the new version.
 * Returns null when the patch's context lines do not match the code (the diff belongs to other code).
 */
export function reconstructBase(newContent: string, patch: string): string | null {
  const newLines = newContent.split("\n");
  const oldLines: string[] = [];
  let next = 1; // next new-file line not yet copied
  for (const hunk of readHunks(patch)) {
    if (hunk.newStart < next) return null; // overlapping or unordered hunks
    oldLines.push(...newLines.slice(next - 1, hunk.newStart - 1));
    next = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        oldLines.push(line.slice(1));
        continue;
      }
      if (line.startsWith(" ") || line === "") {
        const text = line === "" ? "" : line.slice(1);
        if (newLines[next - 1] !== text) return null;
        oldLines.push(text);
      }
      next += 1; // context and "+" lines both consume a new-file line
    }
  }
  oldLines.push(...newLines.slice(next - 1));
  return oldLines.join("\n");
}

/** Parses a multi-file unified diff (git diff / GitHub .diff format). */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const sections = splitIntoFileSections(text.replace(/\r\n/g, "\n"));
  if (sections.length === 0) {
    throw new Error("No file changes found in the diff. Expected lines starting with 'diff --git' or '--- a/…' / '+++ b/…'.");
  }
  return sections.map(parseFileSection);
}

/**
 * Git diffs start every file with "diff --git"; plain unified diffs start each file with a
 * "--- old" line directly followed by "+++ new".
 */
function splitIntoFileSections(text: string): string[][] {
  const lines = text.split("\n");
  const isGitDiff = lines.some((line) => line.startsWith("diff --git "));
  const sections: string[][] = [];
  let current: string[] | null = null;
  lines.forEach((line, index) => {
    const next = lines[index + 1];
    const startsSection = isGitDiff
      ? line.startsWith("diff --git ")
      : line.startsWith("--- ") && next !== undefined && next.startsWith("+++ ");
    if (startsSection) {
      current = [];
      sections.push(current);
    }
    if (current) current.push(line);
  });
  return sections;
}

/** Header facts of one file section. undefined = header line absent, null = /dev/null. */
interface SectionHeader {
  gitOld: string | null;
  gitNew: string | null;
  minusPath: string | null | undefined;
  plusPath: string | null | undefined;
  renameFrom: string | null;
  renameTo: string | null;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

function readSectionHeader(lines: string[]): SectionHeader {
  const header: SectionHeader = {
    gitOld: null,
    gitNew: null,
    minusPath: undefined,
    plusPath: undefined,
    renameFrom: null,
    renameTo: null,
    isNewFile: false,
    isDeletedFile: false,
  };
  for (const line of lines) {
    if (line.startsWith("@@")) break;
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitMatch) {
      header.gitOld = at(gitMatch, 1, "git old path");
      header.gitNew = at(gitMatch, 2, "git new path");
    } else if (line.startsWith("--- ")) header.minusPath = cleanPath(line.slice(4));
    else if (line.startsWith("+++ ")) header.plusPath = cleanPath(line.slice(4));
    else if (line.startsWith("rename from ")) header.renameFrom = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) header.renameTo = line.slice("rename to ".length);
    else if (line.startsWith("new file mode")) header.isNewFile = true;
    else if (line.startsWith("deleted file mode")) header.isDeletedFile = true;
  }
  return header;
}

function parseFileSection(lines: string[]): FileDiff {
  const header = readSectionHeader(lines);
  const oldPath = header.isNewFile ? null : (header.renameFrom ?? (header.minusPath !== undefined ? header.minusPath : header.gitOld));
  const newPath = header.isDeletedFile ? null : (header.renameTo ?? (header.plusPath !== undefined ? header.plusPath : header.gitNew));

  const status = statusFor(oldPath, newPath, header.renameFrom !== null);
  const path = status === "deleted" ? oldPath : newPath;
  if (path === null) {
    throw new Error(`Could not read the file path from diff section:\n${lines.slice(0, 4).join("\n")}`);
  }
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  const patch = hunkStart === -1 ? "" : lines.slice(hunkStart).join("\n");
  return makeFileDiff(path, status === "renamed" ? oldPath : null, status, patch);
}

export function makeFileDiff(path: string, oldPath: string | null, status: ChangeStatus, patch: string): FileDiff {
  return { path, oldPath, status, patch, ...summarizeHunks(patch) };
}

/** "a/src/x.ts" -> "src/x.ts"; "/dev/null" -> null. Strips trailing tab-separated timestamps. */
function cleanPath(raw: string): string | null {
  const path = at(raw.split("\t"), 0, "diff path").trim();
  if (path === "/dev/null") return null;
  return path.replace(/^[ab]\//, "");
}

function statusFor(oldPath: string | null, newPath: string | null, isRename: boolean): ChangeStatus {
  if (oldPath === null) return "added";
  if (newPath === null) return "deleted";
  if (isRename || oldPath !== newPath) return "renamed";
  return "modified";
}

/** The old content of a deleted file: all "-" lines of its patch. */
export function contentOfDeletedFile(diff: FileDiff): string {
  if (diff.status !== "deleted") throw new Error(`Cannot rebuild deleted content of ${diff.path}: status is ${diff.status}`);
  return diff.patch
    .split("\n")
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(1))
    .join("\n");
}

/** Rebuilds the content of a newly added file from its patch (all "+" lines). */
export function contentOfAddedFile(diff: FileDiff): string {
  if (diff.status !== "added") {
    throw new Error(`Cannot rebuild content of ${diff.path}: status is ${diff.status}, not added`);
  }
  return diff.patch
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(1))
    .join("\n");
}
