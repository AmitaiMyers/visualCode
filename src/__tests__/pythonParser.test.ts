import { describe, expect, it } from "vitest";
import { blankStringsAndComments, parsePythonFile } from "../parse/pythonParser";
import { lines } from "./fixtures";

const SOURCE = lines(
  "import os.path as osp",            // 1
  "from .models import (User,",       // 2
  "    Order as O)",                  // 3
  "",                                 // 4
  "class Service:",                   // 5
  '    """def fake(): pass"""',       // 6
  "    @property",                    // 7
  "    def name(self):",              // 8
  "        return self.load()  # call()", // 9
  "",                                 // 10
  "    def load(self):",              // 11
  "        def inner():",             // 12
  "            helper()",             // 13
  "        return User(osp.join('a'))", // 14
  "",                                 // 15
  "def helper():",                    // 16
  "    pass",                         // 17
  "",                                 // 18
  'if __name__ == "__main__":',       // 19
  "    Service().load()",             // 20
);

describe("parsePythonFile", () => {
  const parsed = parsePythonFile({ path: "pkg/service.py", content: SOURCE });

  it("finds classes, methods (with decorators) and functions with line ranges", () => {
    const summary = parsed.symbols.map((s) => [s.qualifiedName, s.kind, s.startLine, s.endLine]);
    expect(summary).toEqual([
      ["Service", "class", 5, 14],
      ["Service.name", "method", 7, 9],
      ["Service.load", "method", 11, 14],
      ["helper", "function", 16, 17],
    ]);
  });

  it("reads plain, aliased and multi-line imports", () => {
    expect(parsed.imports).toEqual([
      { specifier: "os.path", bindings: [{ local: "osp", imported: "*" }] },
      { specifier: ".models", bindings: [{ local: "User", imported: "User" }, { local: "O", imported: "Order" }] },
    ]);
  });

  it("attributes calls to the enclosing symbol, ignoring strings and comments", () => {
    const calls = parsed.calls.map((c) => [c.fromId.split("#")[1] ?? "file", c.qualifier, c.name, c.line]);
    expect(calls).toEqual([
      ["Service.name", "this", "load", 9],
      ["Service.load", null, "helper", 13],
      ["Service.load", null, "User", 14],
      ["Service.load", "osp", "join", 14],
      ["file", null, "Service", 20],
    ]);
  });

  it("blanks strings and comments but keeps line count", () => {
    const blanked = blankStringsAndComments("a = 'x(y)' # z()\nb()");
    expect(blanked.split("\n")).toHaveLength(2);
    expect(blanked).not.toContain("x(y)");
    expect(blanked).not.toContain("z()");
  });
});
