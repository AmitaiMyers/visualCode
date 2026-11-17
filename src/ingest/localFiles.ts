import { unzipSync, strFromU8 } from "fflate";
import type { FileDiff, Project, SourceFile } from "../model/types";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { MAX_FILES, MAX_FILE_BYTES, isSupportedSourcePath, languageOf } from "../parse/language";
import { normalizePath, stripCommonRoot } from "../util/paths";
import { at } from "../util/assert";

/** Files picked with <input webkitdirectory>; paths come from webkitRelativePath. */
export async function loadFromFolder(fileList: FileList): Promise<Project> {
  const files = [...fileList];
  if (files.length === 0) throw new Error("The selected folder is empty.");
  const folderName = at(at(files, 0, "picked file").webkitRelativePath.split("/"), 0, "folder name");
  const entries = files
    .map((file) => ({ path: normalizePath(file.webkitRelativePath), file }))
    .filter(({ path, file }) => isSupportedSourcePath(path) && file.size <= MAX_FILE_BYTES);
  const sources = await Promise.all(entries.map(async ({ path, file }) => ({ path, content: await file.text() })));
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
    throw new Error("The file name must end in .ts, .tsx, .js, .jsx or .py so the code can be parsed.");
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
