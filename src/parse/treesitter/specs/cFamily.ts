import type { Node } from "web-tree-sitter";
import type { CallMatch, FunctionMatch, LanguageSpec } from "../extract";
import { childOfType, field, isSimpleName, kids, lastName, unquote } from "../nodes";

// ---------- C and C++ ----------

/** Follows pointer/reference declarators down to the function declarator's name node. */
function functionNameNode(declarator: Node | null): Node | null {
  let current = declarator;
  while (current !== null && current.type !== "function_declarator") {
    current = field(current, "declarator");
  }
  return current === null ? null : field(current, "declarator");
}

function cFunction(node: Node): FunctionMatch | null {
  if (node.type !== "function_definition") return null;
  const nameNode = functionNameNode(field(node, "declarator"));
  if (nameNode === null) return null;
  if (nameNode.type === "qualified_identifier") {
    // C++ out-of-line definition: void Cart::add(...)
    const scope = field(nameNode, "scope");
    const name = field(nameNode, "name");
    if (name === null) return null;
    return { name: lastName(name.text), receiver: scope === null ? null : lastName(scope.text), selfName: null };
  }
  return { name: lastName(nameNode.text), receiver: null, selfName: null };
}

function cCall(node: Node): CallMatch | null {
  if (node.type !== "call_expression") return null;
  const callee = field(node, "function");
  if (callee === null) return null;
  if (callee.type === "identifier") return { qualifier: null, name: callee.text };
  if (callee.type === "field_expression") {
    const target = field(callee, "argument");
    const name = field(callee, "field");
    if (target === null || name === null) return null;
    if (target.type === "this") return { qualifier: "this", name: name.text };
    return isSimpleName(target.text) ? { qualifier: target.text, name: name.text } : null;
  }
  if (callee.type === "qualified_identifier") {
    const scope = field(callee, "scope");
    const name = field(callee, "name");
    if (name === null) return null;
    return { qualifier: scope === null ? null : lastName(scope.text), name: lastName(name.text) };
  }
  if (callee.type === "template_function") {
    const name = field(callee, "name");
    return name === null ? null : { qualifier: null, name: lastName(name.text) };
  }
  return null;
}

function cInclude(node: Node) {
  if (node.type !== "preproc_include") return null;
  const path = field(node, "path");
  // <system> headers are outside the project; only "quoted" includes can point at project files.
  if (path === null || path.type !== "string_literal") return [];
  return [{ specifier: unquote(path.text), bindings: [] }];
}

/** Structs, classes and unions with a body (forward declarations and type uses have none). */
function cContainer(types: ReadonlySet<string>) {
  return (node: Node) => {
    if (!types.has(node.type) || field(node, "body") === null) return null;
    const name = field(node, "name");
    return name === null ? null : { name: lastName(name.text), primary: true };
  };
}

export const cSpec: LanguageSpec = {
  language: "c",
  selfKeywords: new Set(),
  container: cContainer(new Set(["struct_specifier", "union_specifier", "enum_specifier"])),
  function: cFunction,
  call: cCall,
  imports: cInclude,
};

export const cppSpec: LanguageSpec = {
  language: "cpp",
  selfKeywords: new Set(["this"]),
  container: cContainer(new Set(["class_specifier", "struct_specifier", "union_specifier"])),
  function: cFunction,
  call: cCall,
  imports: cInclude,
};

// ---------- C# ----------

const CSHARP_CONTAINERS = new Set(["class_declaration", "struct_declaration", "interface_declaration", "record_declaration", "record_struct_declaration", "enum_declaration"]);
const CSHARP_FUNCTIONS = new Set(["method_declaration", "constructor_declaration", "destructor_declaration", "operator_declaration"]);

export const csharpSpec: LanguageSpec = {
  language: "csharp",
  selfKeywords: new Set(["this"]),
  container(node) {
    if (!CSHARP_CONTAINERS.has(node.type)) return null;
    const name = field(node, "name");
    // partial classes repeat the name; the first declaration becomes the block, the rest add members
    return name === null ? null : { name: name.text, primary: true };
  },
  function(node) {
    if (!CSHARP_FUNCTIONS.has(node.type)) return null;
    const hasBody = field(node, "body") !== null || childOfType(node, ["block", "arrow_expression_clause"]) !== null;
    const name = field(node, "name") ?? childOfType(node, ["identifier"]);
    if (!hasBody || name === null) return null;
    return { name: name.text, receiver: null, selfName: null };
  },
  call(node) {
    if (node.type === "invocation_expression") {
      const callee = field(node, "function") ?? kids(node)[0] ?? null;
      if (callee === null) return null;
      if (callee.type === "identifier" || callee.type === "generic_name") return { qualifier: null, name: lastName(callee.text) };
      if (callee.type === "member_access_expression") {
        const target = field(callee, "expression");
        const name = field(callee, "name");
        if (target === null || name === null) return null;
        if (target.type === "this_expression" || target.text === "this") return { qualifier: "this", name: lastName(name.text) };
        return isSimpleName(target.text) ? { qualifier: target.text, name: lastName(name.text) } : null;
      }
      return null;
    }
    if (node.type === "object_creation_expression") {
      const type = field(node, "type");
      return type === null ? null : { qualifier: null, name: lastName(type.text) };
    }
    return null;
  },
  imports(node) {
    if (node.type !== "using_directive") return null;
    const name = childOfType(node, ["qualified_name", "identifier"]);
    // namespaces do not map to files; names are found through same-folder and project-wide lookups
    return name === null ? [] : [{ specifier: name.text, bindings: [] }];
  },
};
