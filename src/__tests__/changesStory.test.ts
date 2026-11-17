import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { DEMO_DIFF, DEMO_FILES } from "../demo/sampleProject";
import { buildChangeStory, type Story } from "../graph/story";
import { isTestPath } from "../graph/tests";
import { changeSize, removedLinesAbove } from "../analysis/source";
import { cardRows } from "../canvas/story/storyLayout";
import { symbolId } from "../model/ids";
import { analyze } from "./fixtures";

const demo = () => analyze(DEMO_FILES, parseUnifiedDiff(DEMO_DIFF));
const names = (story: Story): string[] => story.entries.map(({ item }) => (item.type === "block" ? item.symbol.qualifiedName : item.nodeId));

describe("removed lines on cards", () => {
  it("places removed lines above the line they preceded, without repeating lines after the card", () => {
    const removed = (line: number) => (line === 2 ? [{ oldLine: 2, text: "old" }] : line === 4 ? [{ oldLine: 5, text: "after" }] : []);
    expect(cardRows(1, ["a", "b", "c"], removed)).toEqual([
      { kind: "line", line: 1, text: "a" },
      { kind: "removed", oldLine: 2, text: "old" },
      { kind: "line", line: 2, text: "b" },
      { kind: "line", line: 3, text: "c" },
    ]);
  });

  it("leaves out lines of deleted blocks, which get their own cards", () => {
    const analysis = demo();
    const path = "src/checkout/payment.ts";
    const deleted = analysis.graph.nodes.get(symbolId(path, "logCharge"))!.symbol!;
    const above = removedLinesAbove(analysis, path);
    const shown = Object.keys(analysis.diffByPath.get(path)!.removedBefore).flatMap((line) => above(Number(line)));
    expect(shown.some((removed) => removed.oldLine >= deleted.startLine && removed.oldLine <= deleted.endLine)).toBe(false);
  });
});

describe("Changes story", () => {
  it("holds every changed block exactly once, with file paths on the cards", () => {
    const analysis = demo();
    const story = buildChangeStory(analysis.graph, analysis.changes, "flow", (symbol) => changeSize(analysis, symbol));
    const changed = [...analysis.changes.entries()].filter(([id, info]) => info.status !== null && analysis.graph.nodes.get(id)!.kind === "symbol");
    expect(story.entries).toHaveLength(changed.length);
    expect(new Set(names(story)).size).toBe(changed.length);
    expect(story.entries.every(({ item }) => item.type === "block" && item.showPath)).toBe(true);
    expect(story.entries.map(({ item }) => (item.type === "block" ? item.step : 0))).toEqual(story.entries.map((_, index) => index + 1));
  });

  it("puts called code before its callers in foundations order", () => {
    const analysis = demo();
    const story = buildChangeStory(analysis.graph, analysis.changes, "foundations", () => 0);
    const position = (id: string): number => story.entries.findIndex(({ item }) => item.nodeId === id);
    for (const call of story.calls) {
      if (call.fromNodeId !== call.toNodeId) expect(position(call.toNodeId)).toBeLessThan(position(call.fromNodeId));
    }
  });

  it("orders by size in largest-first order", () => {
    const analysis = demo();
    const size = (id: string): number => changeSize(analysis, analysis.graph.nodes.get(id)!.symbol!);
    const story = buildChangeStory(analysis.graph, analysis.changes, "largest", (symbol) => changeSize(analysis, symbol));
    const sizes = story.entries.map(({ item }) => size(item.nodeId));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});

describe("isTestPath", () => {
  it("recognises the test conventions of each language", () => {
    for (const path of ["src/__tests__/a.ts", "a.test.tsx", "pkg/handler_test.go", "tests/test_api.py", "src/test/java/AppTest.java", "spec/user_spec.rb"]) {
      expect(isTestPath(path)).toBe(true);
    }
    for (const path of ["src/contest.ts", "src/testing.py", "src/attestation/main.go"]) {
      expect(isTestPath(path)).toBe(false);
    }
  });
});
