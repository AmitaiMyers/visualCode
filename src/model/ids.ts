// Node id scheme. Ids are stable across reloads so review comments stay attached.

export const ROOT_ID = "dir:";

export function folderId(path: string): string {
  return `dir:${path}`;
}

export function fileId(path: string): string {
  return `file:${path}`;
}

export function symbolId(filePath: string, qualifiedName: string): string {
  return `sym:${filePath}#${qualifiedName}`;
}
