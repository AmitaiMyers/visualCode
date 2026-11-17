import { unzipSync, strFromU8 } from "fflate";
import type { FileDiff, Project, SourceFile } from "../model/types";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { MAX_FILES, MAX_FILE_BYTES, isSupportedSourcePath, languageOf } from "../parse/language";
import { normalizePath, stripCommonRoot } from "../util/paths";
import { at } from "../util/assert";

/** A file plus its path relative to the picked or dropped folder ("my-repo/src/a.ts"). */
export interface LocalEntry {
  path: string;
  file: File;
}

/** Files picked with <input webkitdirectory>; paths come from webkitRelativePath. */
export function entriesFromFileList(fileList: FileList): LocalEntry[] {
  return [...fileList].map((file) => ({ path: file.webkitRelativePath, file }));
}

/** Folders and files dropped onto the window, walked recursively. */
export async function entriesFromDrop(items: DataTransferItemList): Promise<LocalEntry[]> {
  const roots = [...items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const nested = await Promise.all(roots.map((root) => walkEntry(root, "")));
  return nested.flat();
}

async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<LocalEntry[]> {
  const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ path, file }];
  }
  const children = await readAllChildren((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(children.map((child) => walkEntry(child, path)));
  return nested.flat();
}

/** readEntries returns results in batches; keep reading until an empty batch. */
async function readAllChildren(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

export async function loadFromEntries(entries: LocalEntry[]): Promise<Project> {
  if (entries.length === 0) throw new Error("The selected folder is empty.");
  const folderName = at(at(entries, 0, "picked file").path.split("/"), 0, "folder name");
  const sources = await Promise.all(
    entries
      .map(({ path, file }) => ({ path: normalizePath(path), file }))
      .filter(({ path, file }) => isSupportedSourcePath(path) && file.size <= MAX_FILE_BYTES)
      .map(async ({ path, file }) => ({ path, content: await file.text() })),
  );
  return makeLocalProject(`folder:${folderName}`, folderName, sources);
}

export async function loadFromZip(zip: File): Promise<Project> {
  const archive = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const sources: SourceFile[] = Object.entries(archive)
    .filter(([path, bytes]) => !path.endsWith("/") && isSupportedSourcePath(path) && bytes.length <= MAX_FILE_BYTES)
    .map(([path, bytes]) => ({ path: normalizePath(path), content: strFromU8(bytes) }));
  const name = zip.name.replace(/\.zip$/i, "");
  return makeLocalProject(`zip:${name}`, name, sources);
}

/** Pasted code (one file) and/or a pasted unified diff. At least one is required. */
export function loadFromPaste(fileName: string, code: string, diffText: string): Project {
  const hasCode = code.trim() !== "";
  const hasDiff = diffText.trim() !== "";
  if (!hasCode && !hasDiff) throw new Error("Paste some code, a diff, or both.");
  const path = normalizePath(fileName.trim());
  if (hasCode && languageOf(path) === null) {
    throw new Error("The file name must end in .ts, .tsx, .js, .jsx or .py so the code can be read.");
  }
  const diff: FileDiff[] = hasDiff ? parseUnifiedDiff(diffText) : [];
  return {
    id: `paste:${path}`,
    title: hasCode ? "Pasted code" : "Pasted diff",
    files: hasCode ? [{ path, content: code }] : [],
    diff,
  };
}

function makeLocalProject(id: string, title: string, sources: SourceFile[]): Project {
  if (sources.length === 0) throw new Error("No JavaScript, TypeScript or Python files found.");
  if (sources.length > MAX_FILES) {
    throw new Error(`Found ${sources.length} source files (limit ${MAX_FILES}). Pick a smaller folder.`);
  }
  const strip = stripCommonRoot(sources.map((source) => source.path));
  return { id, title, files: sources.map((source) => ({ path: strip(source.path), content: source.content })), diff: [] };
}
