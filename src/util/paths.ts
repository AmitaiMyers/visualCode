// Small POSIX path helpers (the browser has no "path" module).

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((part) => part !== "").join("/"));
}

/** Resolves "." and ".." segments. Throws if the path escapes the project root. */
export function normalizePath(path: string): string {
  const normalized = resolveWithinRoot(path);
  if (normalized === null) {
    throw new Error(`Path escapes the project root: ${path}`);
  }
  return normalized;
}

/**
 * Resolves "." and ".." segments, returning null when the path points above the project root
 * (legitimate for imports that leave a loaded sub-folder).
 */
export function resolveWithinRoot(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

export function stripExtension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? path : path.slice(0, path.length - (name.length - dot));
}

/** Removes a shared leading folder ("repo-main/src/a.ts" -> "src/a.ts") when every path has it. */
export function stripCommonRoot(paths: string[]): (path: string) => string {
  const firstSegments = new Set(paths.map((path) => path.split("/")[0]));
  const allNested = paths.every((path) => path.includes("/"));
  if (firstSegments.size !== 1 || !allNested) {
    return (path) => path;
  }
  const [root] = [...firstSegments];
  const prefix = `${root}/`;
  return (path) => path.slice(prefix.length);
}
