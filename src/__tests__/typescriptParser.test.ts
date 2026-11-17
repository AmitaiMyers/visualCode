import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parseTypeScriptFile } from "../parse/typescriptParser";
import { lines } from "./fixtures";

const SOURCE = lines(
  'import React, { useState as useS } from "react";', // 1
  'import * as api from "./api";',                     // 2
  "",                                                  // 3
  "/** Docs */",                                       // 4
  "export function App() {",                           // 5
  "  const [x] = useS(0);",                            // 6
  "  return <Panel value={api.load(x)} />;",           // 7
  "}",                                                 // 8
  "",                                                  // 9
  "const Panel = (props: { value: number }) => {",     // 10
  "  return <div>{format(props.value)}</div>;",        // 11
  "};",                                                // 12
  "",                                                  // 13
  "class Store {",                                     // 14
  "  items = [];",                                     // 15
  "  add() { this.save(); }",                          // 16
  "  save() {}",                                       // 17
  "}",                                                 // 18
  'export * from "./types";',                          // 19
);

describe("parseTypeScriptFile", () => {
  const parsed = parseTypeScriptFile(ts, { path: "src/App.tsx", content: SOURCE });

  it("finds functions, arrow components, classes and methods (JSDoc included)", () => {
    const summary = parsed.symbols.map((s) => [s.qualifiedName, s.kind, s.startLine, s.endLine]);
    expect(summary).toEqual([
      ["App", "function", 4, 8],
      ["Panel", "function", 10, 12],
      ["Store", "class", 14, 18],
      ["Store.add", "method", 16, 16],
      ["Store.save", "method", 17, 17],
    ]);
  });

  it("reads default, named, namespace and re-export imports", () => {
    expect(parsed.imports).toEqual([
      { specifier: "react", bindings: [{ local: "React", imported: "default" }, { local: "useS", imported: "useState" }] },
      { specifier: "./api", bindings: [{ local: "api", imported: "*" }] },
      { specifier: "./types", bindings: [] },
    ]);
  });

  it("records calls and JSX usages with their lines", () => {
    const calls = parsed.calls.map((c) => [c.fromId.split("#")[1], c.qualifier, c.name, c.line]);
    expect(calls).toEqual([
      ["App", null, "useS", 6],
      ["App", null, "Panel", 7],
      ["App", "api", "load", 7],
      ["Panel", null, "format", 11],
      ["Store.add", "this", "save", 16],
    ]);
  });
});
