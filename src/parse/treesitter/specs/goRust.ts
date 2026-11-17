import type { Node } from "web-tree-sitter";
import type { ImportRef } from "../../../model/types";
import type { LanguageSpec } from "../extract";
import { childOfType, field, isSimpleName, kids, lastName, unquote } from "../nodes";

// ---------- Go ----------

export const goSpec: LanguageSpec = {
  language: "go",
  selfKeywords: new Set(),
  container(node) {
    if (node.type !== "type_spec") return null;
    const type = field(node, "type");
    if (type === null || (type.type !== "struct_type" && type.type !== "interface_type")) return null;
    const name = field(node, "name");
    return name === null ? null : { name: name.text, primary: true };
  },
  function(node) {
    if (node.type === "function_declaration") {
      const name = field(node, "name");
      return name === null || field(node, "body") === null ? null : { name: name.text, receiver: null, selfName: null };
    }
    if (node.type === "method_declaration") {
      const name = field(node, "name");
      if (name === null || field(node, "body") === null) return null;
      // func (s *Store) Add(...): receiver type Store, and "s" means this inside the method
      const receiverList = field(node, "receiver");
      const receiverParam = receiverList === null ? null : childOfType(receiverList, ["parameter_declaration"]);
      const receiverName = receiverParam === null ? null : field(receiverParam, "name");
      const receiverType = receiverParam === null ? null : field(receiverParam, "type");
      return {
        name: name.text,
        receiver: receiverType === null ? null : lastName(receiverType.text.replace(/^\*/, "")),
        selfName: receiverName === null ? null : receiverName.text,
      };
    }
    return null;
  },
  call(node) {
    if (node.type === "call_expression") {
      const callee = field(node, "function");
      if (callee === null) return null;
      if (callee.type === "identifier") return { qualifier: null, name: callee.text };
      if (callee.type === "selector_expression") {
        const operand = field(callee, "operand");
        const name = field(callee, "field");
        if (operand === null || name === null || !isSimpleName(operand.text)) return null;
        return { qualifier: operand.text, name: name.text };
      }
      return null;
    }
    if (node.type === "composite_literal") {
      // Store{...} constructs a Store
      const type = field(node, "type");
      return type === null || type.type !== "type_identifier" ? null : { qualifier: null, name: type.text };
    }
    return null;
  },
  imports(node) {
    if (node.type !== "import_spec") return null;
    const path = field(node, "path");
    if (path === null) return [];
    const importPath = unquote(path.text);
    const alias = field(node, "name");
    if (alias !== null && (alias.text === "_" || alias.text === ".")) return [{ specifier: importPath, bindings: [] }];
    const local = alias === null ? (importPath.split("/").pop() ?? importPath) : alias.text;
    return [{ specifier: importPath, bindings: [{ local, imported: "*" }] }];
  },
};

// ---------- Rust ----------

const RUST_PRIMARY = new Set(["struct_item", "enum_item", "trait_item", "union_item"]);

export const rustSpec: LanguageSpec = {
  language: "rust",
  selfKeywords: new Set(["self", "Self"]),
  container(node) {
    if (RUST_PRIMARY.has(node.type)) {
      const name = field(node, "name");
      return name === null ? null : { name: name.text, primary: true };
    }
    if (node.type === "impl_item") {
      // impl Cart / impl Trait for Cart: adds methods to Cart
      const type = field(node, "type");
      return type === null ? null : { name: lastName(type.text), primary: false };
    }
    return null;
  },
  function(node) {
    if (node.type !== "function_item") return null;
    const name = field(node, "name");
    return name === null || field(node, "body") === null ? null : { name: name.text, receiver: null, selfName: null };
  },
  call(node) {
    if (node.type === "call_expression") {
      let callee = field(node, "function");
      if (callee !== null && callee.type === "generic_function") callee = field(callee, "function");
      if (callee === null) return null;
      if (callee.type === "identifier") return { qualifier: null, name: callee.text };
      if (callee.type === "field_expression") {
        const value = field(callee, "value");
        const name = field(callee, "field");
        if (value === null || name === null) return null;
        if (value.type === "self") return { qualifier: "this", name: name.text };
        return isSimpleName(value.text) ? { qualifier: value.text, name: name.text } : null;
      }
      if (callee.type === "scoped_identifier") {
        const path = field(callee, "path");
        const name = field(callee, "name");
        if (name === null) return null;
        return { qualifier: path === null ? null : lastName(path.text), name: name.text };
      }
      return null;
    }
    if (node.type === "struct_expression") {
      const name = field(node, "name");
      return name === null ? null : { qualifier: null, name: lastName(name.text) };
    }
    return null;
  },
  imports(node) {
    if (node.type === "mod_item") {
      // mod util; (no body) pulls in util.rs or util/mod.rs
      const name = field(node, "name");
      if (name === null || field(node, "body") !== null) return null;
      return [{ specifier: `mod:${name.text}`, bindings: [{ local: name.text, imported: "*" }] }];
    }
    if (node.type !== "use_declaration") return null;
    const argument = field(node, "argument");
    return argument === null ? [] : useTree(argument, "");
  },
};

/** Expands use trees: a::b::C, a::{b, c::D}, a::b as e, a::*. Every leaf becomes one import. */
function useTree(node: Node, prefix: string): ImportRef[] {
  const join = (part: string): string => (prefix === "" ? part : `${prefix}::${part}`);
  switch (node.type) {
    case "identifier":
    case "scoped_identifier":
    case "crate":
    case "self":
    case "super": {
      const path = join(node.text);
      return [rustImport(path, null)];
    }
    case "use_as_clause": {
      const path = field(node, "path");
      const alias = field(node, "alias");
      return path === null ? [] : [rustImport(join(path.text), alias === null ? null : alias.text)];
    }
    case "use_wildcard": {
      const [inner] = kids(node);
      return [{ specifier: join(inner === undefined ? "" : inner.text), bindings: [] }];
    }
    case "scoped_use_list": {
      const path = field(node, "path");
      const list = field(node, "list");
      const nextPrefix = path === null ? prefix : join(path.text);
      return list === null ? [] : kids(list).flatMap((child) => useTree(child, nextPrefix));
    }
    case "use_list":
      return kids(node).flatMap((child) => useTree(child, prefix));
    default:
      return [];
  }
}

function rustImport(path: string, alias: string | null): ImportRef {
  const imported = lastName(path);
  return { specifier: path, bindings: [{ local: alias ?? imported, imported }] };
}
