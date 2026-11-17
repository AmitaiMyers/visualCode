import type { Node } from "web-tree-sitter";
import type { LanguageSpec } from "../extract";
import { childOfType, field, firstDescendantOfType, isSimpleName, kids, lastName, unquote } from "../nodes";

// ---------- PHP ----------

const PHP_CONTAINERS = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"]);
const PHP_INCLUDES = new Set(["require_expression", "require_once_expression", "include_expression", "include_once_expression"]);

function phpQualifier(node: Node): string | null {
  const text = node.text;
  if (text === "$this" || text === "self" || text === "static" || text === "parent") return "this";
  return isSimpleName(lastName(text)) ? lastName(text) : null;
}

export const phpSpec: LanguageSpec = {
  language: "php",
  selfKeywords: new Set(["this"]),
  container(node) {
    if (!PHP_CONTAINERS.has(node.type)) return null;
    const name = field(node, "name");
    return name === null ? null : { name: name.text, primary: true };
  },
  function(node) {
    if (node.type !== "method_declaration" && node.type !== "function_definition") return null;
    const name = field(node, "name");
    return name === null || field(node, "body") === null ? null : { name: name.text, receiver: null, selfName: null };
  },
  call(node) {
    switch (node.type) {
      case "function_call_expression": {
        const callee = field(node, "function");
        return callee === null || !["name", "qualified_name"].includes(callee.type) ? null : { qualifier: null, name: lastName(callee.text) };
      }
      case "member_call_expression":
      case "nullsafe_member_call_expression": {
        const object = field(node, "object");
        const name = field(node, "name");
        if (object === null || name === null) return null;
        const qualifier = object.text === "$this" ? "this" : null;
        return qualifier === null ? null : { qualifier, name: name.text };
      }
      case "scoped_call_expression": {
        const scope = field(node, "scope");
        const name = field(node, "name");
        if (scope === null || name === null) return null;
        const qualifier = phpQualifier(scope);
        return qualifier === null ? null : { qualifier, name: name.text };
      }
      case "object_creation_expression": {
        const type = childOfType(node, ["name", "qualified_name"]);
        return type === null ? null : { qualifier: null, name: lastName(type.text) };
      }
      default:
        return null;
    }
  },
  imports(node) {
    if (node.type === "namespace_use_declaration") {
      return kids(node)
        .filter((child) => child.type === "namespace_use_clause")
        .flatMap((clause) => {
          const name = childOfType(clause, ["qualified_name", "name"]);
          if (name === null) return [];
          const aliasClause = childOfType(clause, ["namespace_aliasing_clause"]);
          const alias = aliasClause === null ? null : childOfType(aliasClause, ["name"]);
          const imported = lastName(name.text);
          return [{ specifier: name.text.replace(/^\\/, ""), bindings: [{ local: alias === null ? imported : alias.text, imported }] }];
        });
    }
    if (PHP_INCLUDES.has(node.type)) {
      // require __DIR__ . '/helpers.php'  ->  the string part is the path relative to this file
      const literal = firstDescendantOfType(node, ["string", "encapsed_string"]);
      return literal === null ? [] : [{ specifier: `path:${unquote(literal.text).replace(/^\//, "")}`, bindings: [] }];
    }
    return null;
  },
};

// ---------- Ruby ----------

const RUBY_REQUIRES = new Set(["require", "require_relative", "load", "autoload"]);

export const rubySpec: LanguageSpec = {
  language: "ruby",
  selfKeywords: new Set(["self"]),
  container(node) {
    if (node.type !== "class") return null; // modules act as namespaces: their contents count as top level
    const name = field(node, "name");
    // classes are often reopened; the first declaration becomes the block
    return name === null ? null : { name: lastName(name.text), primary: true };
  },
  function(node) {
    if (node.type !== "method" && node.type !== "singleton_method") return null;
    const name = field(node, "name");
    return name === null ? null : { name: name.text, receiver: null, selfName: null };
  },
  call(node) {
    if (node.type !== "call") return null;
    const method = field(node, "method");
    if (method === null) return null;
    const receiver = field(node, "receiver");
    if (receiver === null) return { qualifier: null, name: method.text };
    if (method.text === "new" && receiver.type === "constant") return { qualifier: null, name: receiver.text }; // Receipt.new constructs a Receipt
    if (receiver.type === "self") return { qualifier: "this", name: method.text };
    if (receiver.type === "scope_resolution") return { qualifier: lastName(receiver.text), name: method.text };
    return isSimpleName(receiver.text) ? { qualifier: receiver.text, name: method.text } : null;
  },
  imports(node) {
    if (node.type !== "call" || field(node, "receiver") !== null) return null;
    const method = field(node, "method");
    if (method === null || !RUBY_REQUIRES.has(method.text)) return null;
    const literal = firstDescendantOfType(node, ["string"]);
    if (literal === null) return [];
    const path = unquote(literal.text);
    return [{ specifier: method.text === "require_relative" ? `./${path}` : path, bindings: [] }];
  },
};

// ---------- Swift ----------

export const swiftSpec: LanguageSpec = {
  language: "swift",
  selfKeywords: new Set(["self"]),
  container(node) {
    if (node.type === "protocol_declaration") {
      const name = childOfType(node, ["type_identifier"]);
      return name === null ? null : { name: name.text, primary: true };
    }
    if (node.type !== "class_declaration") return null;
    // class / struct / enum have a type_identifier; `extension Cart` has a user_type and only adds members
    const own = childOfType(node, ["type_identifier"]);
    if (own !== null) return { name: own.text, primary: true };
    const extended = childOfType(node, ["user_type"]);
    return extended === null ? null : { name: lastName(extended.text), primary: false };
  },
  function(node) {
    if (node.type === "function_declaration") {
      const name = childOfType(node, ["simple_identifier"]);
      return name === null || childOfType(node, ["function_body"]) === null ? null : { name: name.text, receiver: null, selfName: null };
    }
    if (node.type === "init_declaration" || node.type === "deinit_declaration") {
      return { name: node.type === "init_declaration" ? "init" : "deinit", receiver: null, selfName: null };
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
      if (target.type === "self_expression") return { qualifier: "this", name: name.text };
      return isSimpleName(target.text) ? { qualifier: target.text, name: name.text } : null;
    }
    return null;
  },
  imports(node) {
    // `import Foundation` names a module, not a file: Swift code finds project types by name
    return node.type === "import_declaration" ? [] : null;
  },
};
