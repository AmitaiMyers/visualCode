import { describe, expect, it } from "vitest";
import { detectSystem } from "../system/detect";
import { callPath, findHttpCalls, findRoutes, routeMatches } from "../system/http";
import type { SystemDesign } from "../system/model";
import { lines } from "./fixtures";

const COMPOSE = lines(
  "services:", //                       1
  "  web:", //                          2
  "    build: ./web", //                3
  "    depends_on:", //                 4
  "      - api", //                     5
  "  api:", //                          6
  "    build:", //                      7
  "      context: ./api", //            8
  "    environment:", //                9
  "      DATABASE_URL: postgres://app:app@db:5432/app", // 10
  "    depends_on: [db]", //            11
  "  db:", //                           12
  "    image: postgres:16-alpine", //   13
);

const FILES = new Map([
  ["docker-compose.yml", COMPOSE],
  ["web/package.json", '{ "name": "web", "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" } }'],
  ["web/src/checkout.ts", lines("export async function pay(id: string) {", '  return fetch(`/api/orders/${id}/pay`, { method: "POST" });', "}")],
  ["api/package.json", '{ "name": "api", "dependencies": { "express": "^5.0.0", "pg": "^8.0.0" } }'],
  ["api/src/server.ts", lines('import express from "express";', "const app = express();", 'app.post("/api/orders/:id/pay", (req, res) => res.json({}));')],
  ["api/src/db.ts", lines('import pg from "pg";', "export const db = new pg.Pool();")],
  ["api/src/stripe.ts", lines('export const charge = () => fetch("https://api.stripe.com/v1/charges", { method: "POST" });')],
  ["api/src/cache.ts", lines('import Redis from "ioredis";', "export const redis = new Redis();")],
  ["api/src/cache.test.ts", lines('import Redis from "ioredis";')],
]);

const component = (design: SystemDesign, id: string) => {
  const found = design.components.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No component ${id}: ${design.components.map((c) => c.id).join(", ")}`);
  return found;
};
const connection = (design: SystemDesign, from: string, to: string) => design.connections.find((candidate) => candidate.from === from && candidate.to === to);

describe("detectSystem", () => {
  const design = detectSystem(FILES);

  it("reads apps from compose and classifies them from their manifests", () => {
    expect(component(design, "svc:web")).toMatchObject({ kind: "frontend", technology: "react", rootPath: "web" });
    expect(component(design, "svc:api")).toMatchObject({ kind: "service", technology: "express", rootPath: "api" });
    expect(component(design, "svc:db")).toMatchObject({ kind: "database", technology: "postgres" });
    expect(component(design, "svc:db").evidence[0]).toMatchObject({ path: "docker-compose.yml", line: 12 });
  });

  it("connects services through depends_on and connection URLs, with the line as evidence", () => {
    const toDb = connection(design, "svc:api", "svc:db");
    expect(toDb?.label).toBe("SQL");
    expect(toDb?.evidence.map((evidence) => `${evidence.path}:${evidence.line}`)).toEqual(expect.arrayContaining(["docker-compose.yml:10", "api/src/db.ts:1"]));
  });

  it("matches a frontend's HTTP call to the route another app serves", () => {
    const call = connection(design, "svc:web", "svc:api");
    expect(call?.label).toBe("HTTP POST /api/orders/:id/pay");
    expect(call?.evidence).toEqual(expect.arrayContaining([{ path: "web/src/checkout.ts", line: 2, note: "POST /api/orders/${id}/pay" }]));
  });

  it("adds data stores used only in code and external hosts, ignoring tests", () => {
    expect(component(design, "tech:redis")).toMatchObject({ kind: "cache", rootPath: null });
    expect(connection(design, "svc:api", "tech:redis")?.evidence.map((evidence) => evidence.path)).toEqual(["api/src/cache.ts"]);
    expect(connection(design, "svc:api", "ext:api.stripe.com")?.label).toBe("HTTPS");
  });

  it("falls back to one app for a project without manifests", () => {
    const single = detectSystem(new Map([["main.py", lines("import redis", "r = redis.Redis()")]]));
    expect(single.components.map((c) => c.id)).toEqual(["app:", "tech:redis"]);
  });

  it("reads Kubernetes workloads and their connection settings", () => {
    const k8s = lines(
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: orders",
      "spec:",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: orders",
      "          image: registry.example.com/orders:1.2",
      "          env:",
      "            - name: REDIS_URL",
      "              value: redis://cache.default.svc.cluster.local:6379",
      "---",
      "apiVersion: apps/v1",
      "kind: StatefulSet",
      "metadata:",
      "  name: cache",
      "spec:",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: redis",
      "          image: redis:7",
    );
    const cluster = detectSystem(new Map([["deploy/k8s.yaml", k8s]]));
    expect(component(cluster, "svc:cache")).toMatchObject({ kind: "cache", technology: "redis" });
    expect(connection(cluster, "svc:orders", "svc:cache")).toMatchObject({ label: "Redis", evidence: [{ path: "deploy/k8s.yaml", line: 13, note: "connection setting" }] });
  });
});

describe("HTTP routes and calls", () => {
  it("reads routes in the styles of common frameworks", () => {
    const routes = findRoutes(
      lines('@app.route("/items", methods=["POST"])', '@router.get("/items/{item_id}")', '@GetMapping("/users/{id}")', 'r.GET("/health", health)', 'router.delete("/x/:id", h)'),
    );
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(["POST /items", "GET /items/{item_id}", "GET /users/{id}", "GET /health", "DELETE /x/:id"]);
  });

  it("reads calls and matches them by path segments", () => {
    const [call] = findHttpCalls('const r = requests.get(f"{BASE}/items/{item_id}")');
    expect(call).toMatchObject({ method: "GET", url: "{BASE}/items/{item_id}" });
    expect(callPath(call!.url)).toBe("/items/*");
    expect(routeMatches({ method: "GET", path: "/items/{item_id}", line: 1 }, call!)).toBe(true);
    expect(routeMatches({ method: "POST", path: "/items/{item_id}", line: 1 }, call!)).toBe(false);
  });
});
