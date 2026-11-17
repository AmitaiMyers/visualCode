import { basename, dirname, resolveWithinRoot, stripExtension } from "../util/paths";

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Resolves a relative JS/TS import ("./util", "../lib/x.js") to a project file path.
 * Package imports and path aliases are not resolved (returns null).
 */
export function resolveTsImport(fromPath: string, specifier: string, filePaths: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolveWithinRoot(`${dirname(fromPath)}/${specifier}`);
  if (base === null) return null;
  const withoutJsExtension = /\.[cm]?jsx?$/.test(base) ? stripExtension(base) : base;
  const candidates = [
    base,
    ...TS_EXTENSIONS.map((extension) => `${withoutJsExtension}${extension}`),
    ...TS_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  const match = candidates.find((candidate) => filePaths.has(candidate));
  return match === undefined ? null : match;
}

/** Module path of a Python file: "pkg/sub/mod.py" -> "pkg/sub/mod", "pkg/__init__.py" -> "pkg". */
function pythonModulePath(filePath: string): string {
  const withoutExtension = stripExtension(filePath);
  return basename(withoutExtension) === "__init__" ? dirname(withoutExtension) : withoutExtension;
}

/** Index for resolving absolute Python imports when the source root (e.g. "src/") is unknown. */
export class PythonModuleIndex {
  private readonly byLastSegment = new Map<string, string[]>();
  private readonly byModulePath = new Map<string, string>();

  constructor(filePaths: Iterable<string>) {
    for (const path of filePaths) {
      if (!path.endsWith(".py")) continue;
      const modulePath = pythonModulePath(path);
      this.byModulePath.set(modulePath, path);
      const last = basename(modulePath);
      const bucket = this.byLastSegment.get(last);
      if (bucket) bucket.push(path);
      else this.byLastSegment.set(last, [path]);
    }
  }

  /**
   * Resolves "a.b.c", ".sibling" or "..pkg.mod" imported from fromPath.
   * Absolute imports match any file whose module path ends with the dotted name; the shortest wins.
   */
  resolve(fromPath: string, specifier: string): string | null {
    const dots = specifier.length - specifier.replace(/^\.+/, "").length;
    const rest = specifier.slice(dots).split(".").filter((part) => part !== "").join("/");
    if (dots > 0) {
      return this.resolveRelative(fromPath, dots, rest);
    }
    if (rest === "") return null;
    const bucket = this.byLastSegment.get(basename(rest));
    if (bucket === undefined) return null;
    const matches = bucket.filter((path) => {
      const modulePath = pythonModulePath(path);
      return modulePath === rest || modulePath.endsWith(`/${rest}`);
    });
    matches.sort((a, b) => a.length - b.length);
    const [best] = matches;
    return best === undefined ? null : best;
  }

  private resolveRelative(fromPath: string, dots: number, rest: string): string | null {
    const ups = Array.from({ length: dots - 1 }, () => "..").join("/");
    const packageDir = resolveWithinRoot([dirname(fromPath), ups].filter((part) => part !== "").join("/"));
    if (packageDir === null) return null;
    const modulePath = [packageDir, rest].filter((part) => part !== "").join("/");
    const match = this.byModulePath.get(modulePath);
    return match === undefined ? null : match;
  }
}
