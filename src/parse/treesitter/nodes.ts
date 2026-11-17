import type { Node } from "web-tree-sitter";

/** Named children without the nulls web-tree-sitter may report. */
export function kids(node: Node): Node[] {
  return node.namedChildren.filter((child): child is Node => child !== null);
}

export function field(node: Node, name: string): Node | null {
  return node.childForFieldName(name);
}

export function childOfType(node: Node, types: readonly string[]): Node | null {
  return kids(node).find((child) => types.includes(child.type)) ?? null;
}

export function firstDescendantOfType(node: Node, types: readonly string[]): Node | null {
  const [found] = node.descendantsOfType([...types]).filter((child): child is Node => child !== null);
  return found ?? null;
}

/** Text of a string literal without its quotes ("a/b" -> a/b, 'x' -> x, `x` -> x). */
export function unquote(text: string): string {
  return text.replace(/^[rbfu]*["'`]+|["'`]+$/gi, "");
}

/** Last part of a dotted, scoped or namespaced name: a.b.C, a::b::C, A\B\C -> C. Generic arguments removed. */
export function lastName(text: string): string {
  const withoutGenerics = text.replace(/<[^<>]*>/g, "");
  const parts = withoutGenerics.split(/::|\.|\\|->/).map((part) => part.trim()).filter((part) => part !== "");
  const last = parts[parts.length - 1];
  return last === undefined ? withoutGenerics.trim() : last;
}

/** True for a plain identifier-like token (no calls, indexing or chains). */
export function isSimpleName(text: string): boolean {
  return /^[$@]?[A-Za-z_][\w]*$/.test(text);
}
