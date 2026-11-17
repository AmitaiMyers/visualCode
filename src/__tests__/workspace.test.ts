import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { DEMO_DIFF, DEMO_FILES } from "../demo/sampleProject";
import { reviewOrder } from "../graph/reviewOrder";
import { fileId, folderId, symbolId } from "../model/ids";
import { tokenizeLine } from "../canvas/story/highlight";
import { workspaceReducer, type WorkspaceState } from "../state/workspace";
import { analyze } from "./fixtures";

const demo = () => analyze(DEMO_FILES, parseUnifiedDiff(DEMO_DIFF));

describe("demo project", () => {
  it("parses its diff onto the right blocks", () => {
    const { changes } = demo();
    expect(changes.get(symbolId("src/checkout/cart.ts", "Cart.add"))?.status).toBe("modified");
    expect(changes.get(symbolId("src/checkout/cart.ts", "Cart.total"))?.status).toBe("modified");
    expect(changes.get(symbolId("src/checkout/cart.ts", "roundCents"))?.status).toBe("added");
    expect(changes.get(symbolId("src/checkout/coupons.ts", "findCoupon"))?.status).toBe("added");
    expect(changes.get(symbolId("src/checkout/pricing.ts", "applyDiscount"))?.status).toBe("modified");
    expect(changes.get(symbolId("src/checkout/pricing.ts", "taxFor"))).toBeUndefined();
  });
});

describe("reviewOrder", () => {
  it("lists changed blocks file by file in storyline order", () => {
    const { graph, changes } = demo();
    const names = reviewOrder(graph, changes).map((item) => `${item.filePath}:${item.name}`);
    expect(names).toEqual([
      "src/checkout/cart.ts:Cart.add",
      "src/checkout/cart.ts:Cart.total",
      "src/checkout/cart.ts:roundCents",
      "src/checkout/coupons.ts:types",
      "src/checkout/coupons.ts:setup",
      "src/checkout/coupons.ts:findCoupon",
      "src/checkout/payment.ts:chargeCard",
      "src/checkout/pricing.ts:imports",
      "src/checkout/pricing.ts:applyDiscount",
    ]);
  });
});

describe("workspaceReducer", () => {
  const opened = (): WorkspaceState => {
    const analysis = demo();
    const initial = workspaceReducer({} as WorkspaceState, { type: "projectOpened", analysis, comments: [], viewed: [], layout: { inspectorOpen: true, autoOpenInspector: true } });
    return initial;
  };

  it("opens a project with a diff on the Review tab, scoped below single-folder chains", () => {
    const state = opened();
    expect(state.rail).toBe("review");
    expect(state.scopeId).toBe(folderId("")); // root holds both scripts/ and src/
    expect(state.reviewDirty).toBe(false);
  });

  it("marks review changes dirty so they get saved, and toggles viewed both ways", () => {
    const id = symbolId("src/checkout/cart.ts", "Cart.add");
    const viewed = workspaceReducer(opened(), { type: "setViewed", nodeId: id, viewed: true });
    expect(viewed.viewed.has(id)).toBe(true);
    expect(viewed.reviewDirty).toBe(true);
    expect(workspaceReducer(viewed, { type: "setViewed", nodeId: id, viewed: false }).viewed.has(id)).toBe(false);
  });

  it("on phones, selecting does not cover the canvas with the details panel", () => {
    const phone = workspaceReducer(opened(), { type: "projectOpened", analysis: demo(), comments: [], viewed: [], layout: { inspectorOpen: false, autoOpenInspector: false } });
    expect(workspaceReducer(phone, { type: "select", nodeId: fileId("src/util/format.ts") }).inspectorOpen).toBe(false);
  });

  it("selecting a node reopens the inspector", () => {
    const closed = workspaceReducer(opened(), { type: "setInspectorOpen", open: false });
    const selected = workspaceReducer(closed, { type: "select", nodeId: fileId("src/util/format.ts") });
    expect(selected.inspectorOpen).toBe(true);
  });

  it("merges imported comments by id", () => {
    const comment = { id: "a", nodeId: fileId("src/util/format.ts"), body: "x", source: "human" as const, resolved: false, createdAt: "2026-01-01T00:00:00Z" };
    const once = workspaceReducer(opened(), { type: "mergeComments", comments: [comment] });
    const twice = workspaceReducer(once, { type: "mergeComments", comments: [{ ...comment, body: "y" }] });
    expect(twice.comments.map((c) => c.body)).toEqual(["y"]);
  });
});

describe("tokenizeLine", () => {
  it("separates keywords, strings and comments", () => {
    const tokens = tokenizeLine('const name = "a // b"; // note', "ts").filter((token) => token.kind !== "plain");
    expect(tokens).toEqual([
      { text: "const", kind: "keyword" },
      { text: '"a // b"', kind: "string" },
      { text: "// note", kind: "comment" },
    ]);
  });

  it("handles Python comments and escaped quotes", () => {
    const tokens = tokenizeLine("return 'it\\'s' # done", "py").filter((token) => token.kind !== "plain");
    expect(tokens.map((token) => token.kind)).toEqual(["keyword", "string", "comment"]);
  });
});
