import { describe, expect, it } from "vitest";
import { makeFileDiff } from "../diff/unifiedDiff";
import { fileId, folderId, symbolId } from "../model/ids";
import { buildStory, type StoryEntry } from "../graph/story";
import { computeView, initialScope } from "../graph/view";
import { analyze, lines } from "./fixtures";

// A small app: main.py -> service.run -> helpers.fmt. Written "out of order" on purpose.
const MAIN = lines(
  "from app.service import run",   // 1
  "",                              // 2
  "LIMIT = 3",                     // 3
  "",                              // 4
  "def report(items):",            // 5
  "    return fmt(items)",         // 6
  "",                              // 7
  "def fmt(items):",               // 8
  "    return str(items)",         // 9
  "",                              // 10
  "def collect():",                // 11
  "    return run(LIMIT)",         // 12
  "",                              // 13
  'if __name__ == "__main__":',    // 14
  "    print(report(collect()))",  // 15
);
const SERVICE = lines(
  "from .helpers import clean",    // 1
  "",                              // 2
  "def run(limit):",               // 3
  "    return clean(limit)",       // 4
);
const HELPERS = lines("def clean(x):", "    return x");

const files = [
  { path: "proj/main.py", content: MAIN },
  { path: "proj/app/service.py", content: SERVICE },
  { path: "proj/app/helpers.py", content: HELPERS },
];

function storyOrder(entries: StoryEntry[]): string[] {
  return entries.map((entry) => {
    const label = entry.item.type === "block" ? entry.item.symbol.name : `stub:${entry.item.node.label}`;
    return `${"  ".repeat(entry.depth)}${label}`;
  });
}

describe("graph building", () => {
  const { graph } = analyze(files);

  it("creates module sections for code outside declarations", () => {
    const names = graph.nodes.get(fileId("proj/main.py"))!.childIds.map((id) => graph.nodes.get(id)!.label);
    expect(names).toEqual(["imports", "setup", "entry point", "report", "fmt", "collect"]);
  });

  it("resolves cross-file calls through relative and absolute imports", () => {
    const calls = graph.edges.filter((e) => e.kind === "call").map((e) => `${e.source} -> ${e.target} @${e.line}`);
    expect(calls).toContain(`${symbolId("proj/main.py", "collect")} -> ${symbolId("proj/app/service.py", "run")} @12`);
    expect(calls).toContain(`${symbolId("proj/app/service.py", "run")} -> ${symbolId("proj/app/helpers.py", "clean")} @4`);
    expect(calls).toContain(`${symbolId("proj/main.py", "§entry point")} -> ${symbolId("proj/main.py", "report")} @15`);
  });

  it("starts the map below single-folder chains and lifts edges to the scope's children", () => {
    expect(initialScope(graph)).toBe(folderId("proj"));
    const view = computeView(graph, folderId("proj"), () => true);
    expect(view.nodes.map((n) => [n.node.label, n.ghost])).toEqual([
      ["app", false],
      ["main.py", false],
    ]);
    const edge = view.edges.find((e) => e.source === fileId("proj/main.py"));
    expect(edge?.target).toBe(folderId("proj/app"));
    expect(edge?.kinds.sort()).toEqual(["call", "import"]);
  });

  it("shows outside nodes as ghosts", () => {
    const view = computeView(graph, folderId("proj/app"), () => true);
    expect(view.nodes.filter((n) => n.ghost).map((n) => n.node.label)).toEqual(["main.py"]);
  });
});

describe("storyline", () => {
  const { graph } = analyze(files);

  it("orders blocks by flow: entry points first, callees indented in call order", () => {
    const story = buildStory(graph, "proj/main.py", new Set());
    expect(storyOrder(story.entries)).toEqual([
      "imports",
      "setup",
      "entry point",
      "  report",
      "    fmt",
      "  collect",
      "    stub:run",
    ]);
    const steps = story.entries.flatMap((e) => (e.item.type === "block" ? [e.item.step] : []));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("pulls an expanded stub into the story and continues from it", () => {
    const story = buildStory(graph, "proj/main.py", new Set([symbolId("proj/app/service.py", "run")]));
    expect(storyOrder(story.entries).slice(-2)).toEqual(["    run", "      stub:clean"]);
    const runBlock = story.entries.find((e) => e.item.nodeId === symbolId("proj/app/service.py", "run"))!;
    expect(runBlock.item.type === "block" && runBlock.item.foreign).toBe(true);
  });

  it("puts uncalled class methods after the class header", () => {
    const { graph: classGraph } = analyze([
      {
        path: "c.ts",
        content: lines("class Cart {", "  add() { this.total(); }", "  total() { return 1; }", "}"),
      },
    ]);
    expect(storyOrder(buildStory(classGraph, "c.ts", new Set()).entries)).toEqual(["Cart", "  add", "    total"]);
  });
});

describe("change mapping", () => {
  it("marks touched symbols and rolls counts up to folders", () => {
    const diff = makeFileDiff("proj/main.py", null, "modified", lines("@@ -9,1 +9,1 @@", "-    return repr(items)", "+    return str(items)"));
    const { changes } = analyze(files, [diff]);
    expect(changes.get(symbolId("proj/main.py", "fmt"))?.status).toBe("modified");
    expect(changes.has(symbolId("proj/main.py", "report"))).toBe(false);
    expect(changes.get(fileId("proj/main.py"))).toEqual({ status: "modified", changedDescendants: 1 });
    expect(changes.get(folderId("proj"))?.changedDescendants).toBe(1);
  });

  it("builds nodes for files that only exist in the diff", () => {
    const added = makeFileDiff("proj/new.ts", null, "added", lines("@@ -0,0 +1,1 @@", "+export function hello() {}"));
    const { graph, changes } = analyze(files, [added]);
    expect(changes.get(symbolId("proj/new.ts", "hello"))?.status).toBe("added");
    expect(graph.nodes.has(fileId("proj/new.ts"))).toBe(true);
  });
});

describe("sections", () => {
  it("separates imports, type declarations and setup code", () => {
    const { graph } = analyze([
      {
        path: "t.ts",
        content: lines(
          'import { x } from "./x";',
          "",
          "/** A shape. */",
          "export interface Shape { area: number }",
          "type Id = string;",
          "",
          "const registry = new Map<Id, Shape>();",
          "",
          "export function area(s: Shape) { return s.area; }",
        ),
      },
    ]);
    const labels = graph.nodes.get(fileId("t.ts"))!.childIds.map((id) => graph.nodes.get(id)!.label);
    expect(labels).toEqual(["imports", "types", "setup", "area"]);
  });
});
