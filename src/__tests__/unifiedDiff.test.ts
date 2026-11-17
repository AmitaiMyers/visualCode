import { describe, expect, it } from "vitest";
import { contentOfAddedFile, parseUnifiedDiff } from "../diff/unifiedDiff";
import { lines } from "./fixtures";

const GIT_DIFF = lines(
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,4 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "@@ -10,3 +10,2 @@",
  " ten",
  "-eleven",
  " twelve",
  "diff --git a/src/new.py b/src/new.py",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.py",
  "@@ -0,0 +1,2 @@",
  "+def f():",
  "+    pass",
  "diff --git a/old.ts b/old.ts",
  "deleted file mode 100644",
  "--- a/old.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "diff --git a/x.ts b/y.ts",
  "similarity index 100%",
  "rename from x.ts",
  "rename to y.ts",
);

describe("parseUnifiedDiff", () => {
  const diffs = parseUnifiedDiff(GIT_DIFF);

  it("detects status and paths for each file", () => {
    expect(diffs.map((d) => [d.path, d.oldPath, d.status])).toEqual([
      ["src/a.ts", null, "modified"],
      ["src/new.py", null, "added"],
      ["old.ts", null, "deleted"],
      ["y.ts", "x.ts", "renamed"],
    ]);
  });

  it("maps changed lines onto the new file", () => {
    const [modified] = diffs;
    expect(modified?.addedLines).toEqual([2]);
    expect(modified?.removalAnchors).toEqual([2, 11]);
    expect([modified?.addedCount, modified?.removedCount]).toEqual([1, 2]);
  });

  it("rebuilds content of added files", () => {
    expect(contentOfAddedFile(diffs[1]!)).toBe("def f():\n    pass");
  });

  it("parses plain unified diffs without git headers", () => {
    const plain = parseUnifiedDiff(lines("--- a/m.py", "+++ b/m.py", "@@ -1 +1 @@", "-a", "+b"));
    expect(plain.map((d) => [d.path, d.status, d.addedLines])).toEqual([["m.py", "modified", [1]]]);
  });

  it("fails loudly on text that is not a diff", () => {
    expect(() => parseUnifiedDiff("hello")).toThrow(/No file changes/);
  });
});
