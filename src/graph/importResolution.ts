import type { ImportRef, ParsedFile } from "../model/types";
import { basename, dirname, resolveWithinRoot, stripExtension } from "../util/paths";
import { PythonModuleIndex, resolveTsImport } from "./resolveModules";

/** Where a local name in a file comes from: one or more target files and the name exported there. */
export interface ImportedName {
  targetPaths: string[];
  imported: string; // "*" for the whole module/package, "default", or an exported name
}

/** What one import statement points at. `isModule` means its bindings name the module itself, not an item in it. */
interface ResolvedImport {
  files: string[];
  isModule: boolean;
}

/**
 * Turns import statements into project files, per language. Package and system imports resolve to
 * nothing (they are outside the project). Files are matched by path suffix, because the source root
 * (src/, src/main/java/, lib/…) is not known.
 */
export class ImportResolver {
  private readonly filePaths: Set<string>;
  private readonly pythonIndex: PythonModuleIndex;
  private readonly byStem = new Map<string, string[]>(); // "Strings" -> files named Strings.*
  private readonly byDirName = new Map<string, string[]>(); // "util" -> folders named util
  private readonly filesByDir = new Map<string, string[]>();
  private readonly languageOf = new Map<string, ParsedFile["language"]>();

  constructor(parsedFiles: ParsedFile[]) {
    this.filePaths = new Set(parsedFiles.map((parsed) => parsed.path));
    this.pythonIndex = new PythonModuleIndex(this.filePaths);
    for (const parsed of parsedFiles) {
      this.languageOf.set(parsed.path, parsed.language);
      push(this.byStem, basename(stripExtension(parsed.path)), parsed.path);
      push(this.filesByDir, dirname(parsed.path), parsed.path);
    }
    for (const dir of this.filesByDir.keys()) push(this.byDirName, basename(dir), dir);
  }

  /** Project files imported by this file (packages and unresolvable imports are skipped). */
  importedFiles(parsed: ParsedFile): string[] {
    const targets = new Set<string>();
    for (const ref of parsed.imports) {
      this.resolve(parsed, ref)?.files.forEach((file) => targets.add(file));
      for (const binding of ref.bindings) {
        const submodule = this.pythonSubmodule(parsed, ref.specifier, binding.imported);
        if (submodule !== null) targets.add(submodule);
      }
    }
    targets.delete(parsed.path);
    return [...targets];
  }

  /** Maps each local name bound by an import to the files and name it refers to. */
  importedNames(parsed: ParsedFile): Map<string, ImportedName> {
    const names = new Map<string, ImportedName>();
    for (const ref of parsed.imports) {
      const resolved = this.resolve(parsed, ref);
      for (const binding of ref.bindings) {
        const submodule = this.pythonSubmodule(parsed, ref.specifier, binding.imported);
        if (submodule !== null) {
          names.set(binding.local, { targetPaths: [submodule], imported: "*" });
        } else if (resolved !== null && resolved.files.length > 0) {
          names.set(binding.local, { targetPaths: resolved.files, imported: resolved.isModule ? "*" : binding.imported });
        }
      }
    }
    return names;
  }

  /** For Python "from pkg import mod", the file of pkg.mod when that is a module rather than a name. */
  private pythonSubmodule(parsed: ParsedFile, specifier: string, imported: string): string | null {
    if (parsed.language !== "py" || imported === "*") return null;
    const separator = specifier.endsWith(".") ? "" : ".";
    return this.pythonIndex.resolve(parsed.path, `${specifier}${separator}${imported}`);
  }

  private resolve(parsed: ParsedFile, ref: ImportRef): ResolvedImport | null {
    // Bindings name items inside the target unless the language binds whole modules (Go packages, Rust `mod`).
    const one = (file: string | null, isModule = false): ResolvedImport | null => (file === null ? null : { files: [file], isModule });
    switch (parsed.language) {
      case "ts":
        return one(resolveTsImport(parsed.path, ref.specifier, this.filePaths));
      case "py":
        return one(this.pythonIndex.resolve(parsed.path, ref.specifier));
      case "java":
      case "kotlin":
        return this.resolveJvm(parsed, ref);
      case "go":
        return this.resolveGo(parsed, ref.specifier);
      case "rust":
        return this.resolveRust(parsed, ref.specifier);
      case "c":
      case "cpp":
        return one(this.relativeOrSuffix(parsed.path, ref.specifier));
      case "php":
        return ref.specifier.startsWith("path:")
          ? one(this.relativeOrSuffix(parsed.path, ref.specifier.slice("path:".length)))
          : one(this.bySegments(ref.specifier.split("\\"), "php", parsed));
      case "ruby":
        return one(this.resolveRuby(parsed.path, ref.specifier));
      case "csharp":
      case "swift":
      case "plain":
        return null; // namespaces and modules do not map to files; names are found by the fallbacks
    }
  }

  /** com.acme.util.Strings -> …/com/acme/util/Strings.java (or .kt); a package or Kotlin function -> that folder. */
  private resolveJvm(parsed: ParsedFile, ref: ImportRef): ResolvedImport | null {
    const segments = ref.specifier.split(".");
    if (ref.bindings.length > 0) {
      const file = this.fileByPathSuffix(segments.join("/"), parsed);
      if (file !== null) return { files: [file], isModule: false };
    }
    const packageSegments = ref.bindings.length > 0 ? segments.slice(0, -1) : segments;
    const files = this.packageFiles(packageSegments, parsed);
    return files.length === 0 ? null : { files, isModule: false };
  }

  /** github.com/acme/app/internal/util -> every Go file in the project folder ending in internal/util. */
  private resolveGo(parsed: ParsedFile, importPath: string): ResolvedImport | null {
    const segments = importPath.split("/");
    if (segments.length < 2) return null; // standard library ("fmt") or unqualified paths
    const files = this.packageFiles(segments, parsed, Math.min(2, segments.length));
    return files.length === 0 ? null : { files, isModule: true };
  }

  /** crate::store::Store -> store.rs (item Store); `mod util;` -> util.rs or util/mod.rs next to this module. */
  private resolveRust(parsed: ParsedFile, specifier: string): ResolvedImport | null {
    if (specifier.startsWith("mod:")) {
      const name = specifier.slice("mod:".length);
      const stem = basename(stripExtension(parsed.path));
      const moduleDir = ["mod", "lib", "main"].includes(stem) ? dirname(parsed.path) : stripExtension(parsed.path);
      const file = [`${moduleDir}/${name}.rs`, `${moduleDir}/${name}/mod.rs`].map(trimLeadingSlash).find((candidate) => this.filePaths.has(candidate));
      return file === undefined ? null : { files: [file], isModule: true };
    }
    const segments = specifier.split("::").filter((segment) => !["crate", "self", "super", "Self"].includes(segment));
    for (let length = segments.length; length >= 1; length -= 1) {
      const modulePath = segments.slice(0, length).join("/");
      const file = this.fileByPathSuffix(modulePath, parsed) ?? this.fileByPathSuffix(`${modulePath}/mod`, parsed);
      if (file !== null) return { files: [file], isModule: length === segments.length };
    }
    return null;
  }

  /** require_relative "x" -> x.rb next to this file; require "app/models/user" -> …/app/models/user.rb. */
  private resolveRuby(fromPath: string, specifier: string): string | null {
    const path = specifier.endsWith(".rb") ? specifier : `${specifier}.rb`;
    if (specifier.startsWith("./")) {
      const relative = resolveWithinRoot(`${dirname(fromPath)}/${path}`);
      return relative !== null && this.filePaths.has(relative) ? relative : null;
    }
    return this.fileBySuffix(path);
  }

  /** "util/strings.h" relative to the including file first, then anywhere in the project by suffix. */
  private relativeOrSuffix(fromPath: string, specifier: string): string | null {
    const relative = resolveWithinRoot(`${dirname(fromPath)}/${specifier}`);
    if (relative !== null && this.filePaths.has(relative)) return relative;
    return this.fileBySuffix(specifier);
  }

  /** PHP namespaces map to folders loosely (PSR-4): match the longest trailing part of App\Util\Strings. */
  private bySegments(segments: string[], language: "php", parsed: ParsedFile): string | null {
    for (let take = segments.length; take >= 1; take -= 1) {
      const file = this.fileByPathSuffix(segments.slice(segments.length - take).join("/"), parsed);
      if (file !== null && this.languageOf.get(file) === language) return file;
    }
    return null;
  }

  /** A file of the same language whose path without extension ends with `pathWithoutExtension`; shortest wins. */
  private fileByPathSuffix(pathWithoutExtension: string, parsed: ParsedFile): string | null {
    const candidates = (this.byStem.get(basename(pathWithoutExtension)) ?? []).filter((file) => {
      const stem = stripExtension(file);
      return this.languageOf.get(file) === parsed.language && (stem === pathWithoutExtension || stem.endsWith(`/${pathWithoutExtension}`));
    });
    return shortest(candidates);
  }

  private fileBySuffix(path: string): string | null {
    const candidates = (this.byStem.get(basename(stripExtension(path))) ?? []).filter((file) => file === path || file.endsWith(`/${path}`));
    return shortest(candidates);
  }

  /**
   * Files of a package folder: the longest trailing part of the package path (at least `minSegments`)
   * that names a project folder.
   */
  private packageFiles(segments: string[], parsed: ParsedFile, minSegments = 1): string[] {
    for (let take = segments.length; take >= minSegments && take >= 1; take -= 1) {
      const suffix = segments.slice(segments.length - take).join("/");
      const dirs = (this.byDirName.get(basename(suffix)) ?? []).filter((dir) => dir === suffix || dir.endsWith(`/${suffix}`));
      const dir = shortest(dirs);
      if (dir !== null) {
        const files = (this.filesByDir.get(dir) ?? []).filter((file) => this.languageOf.get(file) === parsed.language && file !== parsed.path);
        if (files.length > 0) return files;
      }
    }
    return [];
  }
}

function push<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function shortest(paths: string[]): string | null {
  const [best] = [...paths].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return best === undefined ? null : best;
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/, "");
}
