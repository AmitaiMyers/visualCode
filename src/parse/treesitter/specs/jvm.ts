import type { Node } from "web-tree-sitter";
import type { ImportRef } from "../../../model/types";
import type { CallMatch, LanguageSpec } from "../extract";
import { childOfType, field, isSimpleName, kids, lastName } from "../nodes";

const JAVA_CONTAINERS = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"]);

export const javaSpec: LanguageSpec = {
  language: "java",
  selfKeywords: new Set(["this"]),
  container(node) {
    if (!JAVA_CONTAINERS.has(node.type)) return null;
    const name = field(node, "name");
    return name === null ? null : { name: name.text, primary: true };
  },
  function(node) {
    if (node.type !== "method_declaration" && node.type !== "constructor_declaration") return null;
    const name = field(node, "name");
    if (name === null || field(node, "body") === null) return null; // abstract and interface methods have no body
    return { name: name.text, receiver: null, selfName: null };
  },
  call(node) {
    if (node.type === "method_invocation") {
      const name = field(node, "name");
      if (name === null) return null;
      const object = field(node, "object");
      return qualified(object, name.text);
    }
    if (node.type === "object_creation_expression") {
      const type = field(node, "type");
      return type === null ? null : { qualifier: null, name: lastName(type.text) };
    }
    return null;
  },
  imports(node) {
    if (node.type !== "import_declaration") return null;
    const isStatic = node.text.includes(" static ");
    const path = node.text.replace(/^import\s+(static\s+)?/, "").replace(/;\s*$/, "").trim();
    return [jvmImport(path, null, isStatic)];
  },
};

export const kotlinSpec: LanguageSpec = {
  language: "kotlin",
  selfKeywords: new Set(["this"]),
  container(node) {
    if (node.type !== "class_declaration" && node.type !== "object_declaration") return null;
    const name = childOfType(node, ["type_identifier"]);
    return name === null ? null : { name: name.text, primary: true };
  },
  function(node) {
    if (node.type === "function_declaration") {
      const name = childOfType(node, ["simple_identifier"]);
      if (name === null || childOfType(node, ["function_body"]) === null) return null;
      return { name: name.text, receiver: null, selfName: null };
    }
    if (node.type === "secondary_constructor" || node.type === "anonymous_initializer") {
      return { name: node.type === "secondary_constructor" ? "constructor" : "init", receiver: null, selfName: null };
    }
    return null;
  },
  call(node) {
    if (node.type !== "call_expression") return null;
    const [callee] = kids(node);
    if (callee === undefined) return null;
    if (callee.type === "simple_identifier") return { qualifier: null, name: callee.text };
    if (callee.type === "navigation_expression") {
      const [target, suffix] = kids(callee);
      const name = suffix === undefined ? null : childOfType(suffix, ["simple_identifier"]);
      if (target === undefined || name === null) return null;
      if (target.type === "this_expression") return { qualifier: "this", name: name.text };
      return isSimpleName(target.text) ? { qualifier: target.text, name: name.text } : null;
    }
    return null;
  },
  imports(node) {
    if (node.type !== "import_header") return null;
    const identifier = childOfType(node, ["identifier"]);
    if (identifier === null) return [];
    const alias = childOfType(node, ["import_alias"]);
    const aliasName = alias === null ? null : childOfType(alias, ["type_identifier", "simple_identifier"]);
    const wildcard = childOfType(node, ["wildcard_import"]) !== null || node.text.trim().endsWith(".*");
    return [jvmImport(wildcard ? `${identifier.text}.*` : identifier.text, aliasName === null ? null : aliasName.text, false)];
  },
};

/** "a.b.C" imports class (or Kotlin top-level function) C from a/b/C; "a.b.*" imports the package; static imports a class member. */
function jvmImport(path: string, alias: string | null, isStatic: boolean): ImportRef {
  if (path.endsWith(".*")) return { specifier: path.slice(0, -2), bindings: [] };
  const parts = path.split(".");
  const imported = parts[parts.length - 1] ?? path;
  if (isStatic) return { specifier: parts.slice(0, -1).join("."), bindings: [{ local: alias ?? imported, imported }] };
  return { specifier: path, bindings: [{ local: alias ?? imported, imported }] };
}

function qualified(object: Node | null, name: string): CallMatch | null {
  if (object === null) return { qualifier: null, name };
  if (object.type === "this") return { qualifier: "this", name };
  return isSimpleName(object.text) ? { qualifier: object.text, name } : null;
}
