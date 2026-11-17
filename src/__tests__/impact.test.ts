import { describe, expect, it } from "vitest";
import { impactOf, callerCount } from "../graph/impact";
import { fileId, symbolId } from "../model/ids";
import { analyze, lines } from "./fixtures";

// tax <- price <- checkout <- test_checkout (3 calls away); test_tax imports tax directly.
const PRICING = lines(
  "def tax(amount):", //         1
  "    return amount * 0.2", //  2
  "", //                         3
  "def price(amount):", //       4
  "    return amount + tax(amount)", // 5
);
const CHECKOUT = lines(
  "from app.pricing import price", // 1
  "", //                             2
  "def checkout(cart):", //          3
  "    total = price(cart)", //      4
  "    return price(total)", //      5
);
const TEST_CHECKOUT = lines(
  "from app.checkout import checkout", // 1
  "", //                                 2
  "def test_checkout():", //             3
  "    assert checkout(1) > 0", //       4
);
const TEST_TAX = lines(
  "from app.pricing import tax", // 1
  "", //                           2
  "def test_tax():", //            3
  "    assert tax(10) == 2", //    4
);

const project = () =>
  analyze([
    { path: "app/pricing.py", content: PRICING },
    { path: "app/checkout.py", content: CHECKOUT },
    { path: "tests/test_checkout.py", content: TEST_CHECKOUT },
    { path: "tests/test_tax.py", content: TEST_TAX },
  ]);

describe("impactOf", () => {
  it("groups callers by file, one entry per call site", () => {
    const { graph } = project();
    const impact = impactOf(graph, symbolId("app/pricing.py", "price"));
    expect(impact.callerGroups).toEqual([
      {
        filePath: "app/checkout.py",
        callers: [
          { nodeId: symbolId("app/checkout.py", "checkout"), label: "checkout", line: 4 },
          { nodeId: symbolId("app/checkout.py", "checkout"), label: "checkout", line: 5 },
        ],
      },
    ]);
    expect(impact.callerCount).toBe(2);
    expect(callerCount(graph, symbolId("app/pricing.py", "price"))).toBe(2);
  });

  it("finds tests through chains of callers, nearest first", () => {
    const { graph } = project();
    const tests = impactOf(graph, symbolId("app/pricing.py", "tax")).tests.map((test) => `${test.label}@${test.distance}`);
    expect(tests).toEqual(["test_tax@1", "test_checkout@3"]);
  });

  it("lists importers of a file and the test files that import it", () => {
    const { graph } = project();
    const impact = impactOf(graph, fileId("app/pricing.py"));
    expect(impact.callerGroups.map((group) => group.filePath)).toEqual(["app/checkout.py", "tests/test_tax.py"]);
    expect(impact.tests.map((test) => test.filePath)).toEqual(["tests/test_tax.py"]);
  });
});
