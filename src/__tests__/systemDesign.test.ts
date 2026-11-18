import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { DEMO_DIFF, DEMO_FILES } from "../demo/sampleProject";
import { impactOf } from "../graph/impact";
import { symbolId } from "../model/ids";
import { detectSystem } from "../system/detect";
import { NO_EDITS, addComponent, addConnection, applyEdits, removeItem } from "../system/edits";
import { toMermaid, toStructurizr } from "../system/export";
import { appLanguages, buildIntegrationPlan, draftRequest } from "../system/plan";
import type { SystemDesign } from "../system/model";
import { analyze } from "./fixtures";

const demo = () => analyze(DEMO_FILES, parseUnifiedDiff(DEMO_DIFF));

describe("the demo's system", () => {
  const analysis = demo();
  const design = detectSystem(analysis.contents);
  const ids = (list: { id: string }[]) => list.map((item) => item.id).sort();

  it("has a web frontend calling the API, which uses Postgres", () => {
    expect(ids(design.components)).toEqual(["svc:api", "svc:db", "svc:web"]);
    expect(design.components.find((c) => c.id === "svc:web")).toMatchObject({ kind: "frontend", technology: "react" });
    expect(design.components.find((c) => c.id === "svc:api")).toMatchObject({ kind: "service", technology: "express", rootPath: "" });
    expect(design.connections.map((c) => `${c.from} -> ${c.to}: ${c.label}`).sort()).toEqual([
      "svc:api -> svc:db: SQL",
      "svc:web -> svc:api: HTTP · 2 routes",
    ]);
  });

  it("guides adding Redis to the API: package, compose, env, client and the data-access blocks to cache", () => {
    const api = design.components.find((c) => c.id === "svc:api")!;
    expect(appLanguages(analysis, api)[0]).toBe("ts");
    const plan = buildIntegrationPlan(analysis, design, "redis", api, "ts");
    expect(plan.steps.map((step) => step.title)).toEqual(["Add the client library", "Run it next to the app", "Configure the connection", "Create the client", "Use it in the code"]);
    expect(plan.steps[0]!.snippets[0]!.text).toBe("npm install redis");
    expect(plan.steps[1]!.snippets.map((snippet) => snippet.file)).toEqual(["docker-compose.yml", "docker-compose.yml"]);
    expect(plan.steps[1]!.snippets[1]!.text).toContain("depends_on:\n      - redis");
    expect(plan.steps[2]!.snippets[0]).toMatchObject({ file: ".env.example", text: "REDIS_URL=redis://localhost:6379" });
    expect(plan.steps[3]!.snippets[0]!.file).toBe("src/db/redis.ts");
    expect(plan.steps[4]!.touchPoints.map((point) => point.label)).toEqual(["saveOrder", "findOrder"]);
    const draft = draftRequest(analysis, plan);
    expect(draft.prompt).toContain('<block name="findOrder" path="src/db/orders.ts"');
    expect(draft.includes).toEqual(["the integration plan (generated, no project code)", "src/db/orders.ts: saveOrder", "src/db/orders.ts: findOrder"]);
  });

  it("puts write routes first for a message broker", () => {
    const api = design.components.find((c) => c.id === "svc:api")!;
    const plan = buildIntegrationPlan(analysis, design, "kafka", api, "py");
    expect(plan.steps[0]!.snippets[0]!.text).toBe("pip install confluent-kafka");
    expect(plan.steps[4]!.touchPoints.map((point) => point.reason)).toEqual([expect.stringContaining("handles POST /api/checkout")]);
    expect(plan.steps.at(-1)!.title).toBe("Before production");
  });

  it("links calls on a variable named after its class (cart.total) and finds the test that makes them", () => {
    const impact = impactOf(analysis.graph, symbolId("src/checkout/cart.ts", "Cart.total"));
    expect(impact.callerGroups.flatMap((group) => group.callers.map((caller) => caller.label))).toEqual(["setup", "runCheckout", "handleCheckout"]); // grouped by file: cart.test.ts, index.ts, server.ts
    expect(impact.tests.map((test) => `${test.filePath}@${test.distance}`)).toEqual(["src/checkout/cart.test.ts@1"]);
  });
});

describe("system edits", () => {
  const detected: SystemDesign = {
    components: [
      { id: "svc:api", name: "api", kind: "service", technology: null, rootPath: "", evidence: [], origin: "detected" },
      { id: "svc:db", name: "db", kind: "database", technology: "postgres", rootPath: null, evidence: [], origin: "detected" },
    ],
    connections: [{ id: "svc:api->svc:db", from: "svc:api", to: "svc:db", label: "SQL", evidence: [], origin: "detected" }],
  };

  it("adds components with unique ids and connects them", () => {
    const first = addComponent(NO_EDITS, { name: "redis", kind: "cache", technology: "redis" }, new Set(["added:redis"]));
    expect(first.id).toBe("added:redis-2");
    const connected = addConnection(first.edits, "svc:api", first.id, "Redis");
    const design = applyEdits(detected, connected);
    expect(design.connections.map((c) => c.id)).toEqual(["svc:api->svc:db", "svc:api->added:redis-2"]);
  });

  it("hides detected items, and drops connections to removed components", () => {
    const design = applyEdits(detected, removeItem(NO_EDITS, "svc:db"));
    expect(design.components.map((c) => c.id)).toEqual(["svc:api"]);
    expect(design.connections).toEqual([]);
  });

  it("deletes added components together with their connections", () => {
    const { edits, id } = addComponent(NO_EDITS, { name: "worker", kind: "worker", technology: null }, new Set());
    const removed = removeItem(addConnection(edits, id, "svc:db", "SQL"), id);
    expect(removed.added).toEqual([]);
    expect(removed.addedConnections).toEqual([]);
  });
});

describe("exports", () => {
  const design: SystemDesign = {
    components: [
      { id: "svc:web", name: "web", kind: "frontend", technology: "react", rootPath: "web", evidence: [], origin: "detected" },
      { id: "svc:end", name: "end", kind: "service", technology: "express", rootPath: "", evidence: [], origin: "detected" },
      { id: "svc:db", name: "db", kind: "database", technology: "postgres", rootPath: null, evidence: [], origin: "detected" },
      { id: "ext:api.stripe.com", name: "api.stripe.com", kind: "external", technology: null, rootPath: null, evidence: [], origin: "detected" },
    ],
    connections: [
      { id: "a", from: "svc:web", to: "svc:end", label: 'HTTP POST "/api"', evidence: [], origin: "detected" },
      { id: "b", from: "svc:end", to: "svc:db", label: "SQL", evidence: [], origin: "detected" },
      { id: "c", from: "svc:end", to: "ext:api.stripe.com", label: "HTTPS", evidence: [], origin: "detected" },
    ],
  };

  it("writes a Mermaid flowchart with shapes per kind and safe identifiers", () => {
    const mermaid = toMermaid(design);
    expect(mermaid.split("\n")[0]).toBe("flowchart LR");
    expect(mermaid).toContain('db[("db<br/><i>Database · PostgreSQL</i>")]');
    expect(mermaid).toContain("end_2["); // "end" is a Mermaid keyword
    expect(mermaid).toContain('web -->|"HTTP POST #quot;/api#quot;"| end_2');
    expect(mermaid).toContain("api_stripe_com((");
  });

  it("writes a Structurizr workspace with containers, an external system and relationships", () => {
    const dsl = toStructurizr(design, "Acme shop");
    expect(dsl).toContain('project = softwareSystem "Acme shop" {');
    expect(dsl).toContain('db = container "db" "Database" "PostgreSQL" {');
    expect(dsl).toContain('api_stripe_com = softwareSystem "api.stripe.com" "External service" {');
    expect(dsl).toContain('web -> end_2 "HTTP POST \\"/api\\""');
    expect(dsl).toContain("container project \"Containers\" {");
    expect(dsl.split("{").length).toBe(dsl.split("}").length);
  });
});
