import { LineCounter, isMap, isPair, isScalar, isSeq, parseAllDocuments, type Node as YamlNode, type YAMLMap } from "yaml";
import { isTestPath } from "../graph/tests";
import { isParsedLanguage, languageOf } from "../parse/language";
import { basename, dirname, resolveWithinRoot } from "../util/paths";
import { TECHNOLOGIES, type Technology } from "./catalog";
import { findHttpCalls, findRoutes, hostOf, routeMatches, type HttpCall, type Route } from "./http";
import { connectionId, type ComponentKind, type Evidence, type SystemComponent, type SystemConnection, type SystemDesign } from "./model";

/** Evidence kept per component or connection: enough to point at, not every line. */
export const MAX_EVIDENCE = 6;

const COMPOSE_FILE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const MANIFEST_FILES = new Set(["package.json", "composer.json", "requirements.txt", "pyproject.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "Gemfile"]);
const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

interface Framework {
  label: string;
  kind: ComponentKind;
  name: string; // dependency name as it appears in manifests
}

/** Dependencies that say what an app is. Service frameworks win over frontend ones (an app with both serves). */
const FRAMEWORKS: Framework[] = [
  ...framework("service", [
    ["express", "express"], ["fastify", "fastify"], ["koa", "koa"], ["@nestjs/core", "nestjs"], ["hono", "hono"], ["flask", "flask"], ["fastapi", "fastapi"],
    ["django", "django"], ["gin-gonic/gin", "gin"], ["labstack/echo", "echo"], ["go-chi/chi", "chi"], ["gorilla/mux", "gorilla"], ["spring-boot", "spring boot"],
    ["rails", "rails"], ["sinatra", "sinatra"], ["laravel/framework", "laravel"], ["actix-web", "actix"], ["axum", "axum"], ["rocket", "rocket"], ["ktor", "ktor"],
  ]),
  ...framework("frontend", [
    ["next", "next.js"], ["nuxt", "nuxt"], ["react", "react"], ["vue", "vue"], ["svelte", "svelte"], ["@angular/core", "angular"], ["solid-js", "solid"], ["preact", "preact"],
  ]),
  ...framework("worker", [["celery", "celery"], ["bullmq", "bullmq"], ["bull", "bull"], ["sidekiq", "sidekiq"], ["rq", "rq"], ["dramatiq", "dramatiq"]]),
];

function framework(kind: ComponentKind, entries: [name: string, label: string][]): Framework[] {
  return entries.map(([name, label]) => ({ name, label, kind }));
}

const RUNTIME_BY_MANIFEST: Record<string, string> = {
  "package.json": "Node.js",
  "composer.json": "PHP",
  "requirements.txt": "Python",
  "pyproject.toml": "Python",
  "go.mod": "Go",
  "pom.xml": "Java",
  "build.gradle": "JVM",
  "build.gradle.kts": "JVM",
  "Cargo.toml": "Rust",
  Gemfile: "Ruby",
};

/**
 * Reads the system design out of a project: apps from docker compose, Kubernetes workloads and manifests;
 * data stores and brokers from images and client libraries in code; connections from depends_on,
 * connection URLs, client usage and HTTP calls matched to the routes other apps define.
 */
export function detectSystem(files: ReadonlyMap<string, string>): SystemDesign {
  const design = new DesignBuilder();
  const paths = [...files.keys()].sort();
  const content = (path: string): string => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`Missing content for ${path}`);
    return text;
  };

  for (const path of paths) {
    if (COMPOSE_FILE.test(path)) readCompose(design, path, content(path));
    else if (/\.ya?ml$/.test(path) && /^kind:\s*\w+/m.test(content(path))) readKubernetes(design, path, content(path));
  }
  for (const path of paths) {
    if (MANIFEST_FILES.has(basename(path))) readManifest(design, path, content(path));
  }
  if (design.apps().length === 0 && paths.some((path) => isCode(path))) {
    design.component({ id: "app:", name: "app", kind: "service", technology: null, rootPath: "" }, { path: paths.find(isCode) ?? "", line: null, note: "source code" });
  }

  const routes = new Map<string, { path: string; route: Route }[]>(); // app id -> routes it serves
  const calls: { appId: string; path: string; call: HttpCall }[] = [];
  for (const path of paths) {
    if (isTestPath(path) || COMPOSE_FILE.test(path)) continue;
    const app = design.appOf(path);
    if (app === null) continue;
    const text = content(path);
    readClientUsage(design, app, path, text);
    if (!isCode(path)) continue;
    for (const route of findRoutes(text)) routes.set(app.id, [...(routes.get(app.id) ?? []), { path, route }]);
    for (const call of findHttpCalls(text)) calls.push({ appId: app.id, path, call });
  }
  for (const { appId, path, call } of calls) connectHttpCall(design, appId, path, call, routes);
  return design.build();
}

function isCode(path: string): boolean {
  const language = languageOf(path);
  return language !== null && isParsedLanguage(language);
}

// ---------------------------------------------------------------------------
// Builder: merges what different files say about the same component or connection.

interface ConnectionDraft {
  from: string;
  to: string;
  protocol: string;
  evidence: Evidence[];
  routes: Set<string>; // "POST /api/checkout" for HTTP connections
}

class DesignBuilder {
  private readonly components = new Map<string, SystemComponent>();
  private readonly connections = new Map<string, ConnectionDraft>();

  component(draft: Omit<SystemComponent, "evidence" | "origin">, evidence: Evidence): SystemComponent {
    const existing = this.components.get(draft.id);
    if (existing !== undefined) {
      addEvidence(existing.evidence, evidence);
      return existing;
    }
    const created: SystemComponent = { ...draft, evidence: [evidence], origin: "detected" };
    this.components.set(draft.id, created);
    return created;
  }

  /** What a manifest says about an app another file declared: its kind and framework. */
  classify(id: string, kind: ComponentKind, technology: string | null, evidence: Evidence): void {
    const component = this.components.get(id);
    if (component === undefined) throw new Error(`Unknown component: ${id}`);
    addEvidence(component.evidence, evidence);
    this.components.set(id, { ...component, kind, technology });
  }

  find(id: string): SystemComponent | undefined {
    return this.components.get(id);
  }

  byRoot(rootPath: string): SystemComponent | undefined {
    return [...this.components.values()].find((component) => component.rootPath === rootPath);
  }

  /** The component for a technology: a compose service running it, else one created from code evidence. */
  forTechnology(technology: Technology, evidence: Evidence): SystemComponent {
    const running = [...this.components.values()].find((component) => component.technology === technology.id);
    if (running !== undefined) return running;
    return this.component({ id: `tech:${technology.id}`, name: technology.id, kind: technology.kind, technology: technology.id, rootPath: null }, evidence);
  }

  apps(): SystemComponent[] {
    return [...this.components.values()].filter((component) => component.rootPath !== null);
  }

  /** The app whose folder holds the file most specifically. */
  appOf(path: string): SystemComponent | null {
    let best: SystemComponent | null = null;
    for (const app of this.apps()) {
      const root = app.rootPath ?? "";
      const inside = root === "" || path === root || path.startsWith(`${root}/`);
      if (inside && (best === null || root.length > (best.rootPath ?? "").length)) best = app;
    }
    return best;
  }

  connect(from: string, to: string, protocol: string, evidence: Evidence, route: string | null = null): void {
    if (from === to) return;
    const id = connectionId(from, to);
    const draft = this.connections.get(id) ?? { from, to, protocol, evidence: [], routes: new Set<string>() };
    addEvidence(draft.evidence, evidence);
    if (route !== null) draft.routes.add(route);
    this.connections.set(id, draft);
  }

  build(): SystemDesign {
    const connections: SystemConnection[] = [...this.connections.entries()].map(([id, draft]) => ({
      id,
      from: draft.from,
      to: draft.to,
      label: connectionLabel(draft),
      evidence: draft.evidence,
      origin: "detected",
    }));
    return { components: [...this.components.values()], connections };
  }
}

function addEvidence(list: Evidence[], evidence: Evidence): void {
  if (list.length >= MAX_EVIDENCE || list.some((seen) => seen.path === evidence.path && seen.line === evidence.line)) return;
  list.push(evidence);
}

function connectionLabel(draft: ConnectionDraft): string {
  const routes = [...draft.routes];
  if (routes.length === 1) return `${draft.protocol} ${routes[0] ?? ""}`;
  if (routes.length > 1) return `${draft.protocol} · ${routes.length} routes`;
  return draft.protocol;
}

// ---------------------------------------------------------------------------
// Deployment files.

function technologyOfImage(image: string): Technology | undefined {
  const parts = image.split("/");
  const first = parts[0] ?? "";
  const withoutRegistry = parts.length > 1 && /[.:]/.test(first) ? parts.slice(1).join("/") : image;
  const name = withoutRegistry.replace(/^library\//, "");
  return TECHNOLOGIES.find((technology) => technology.images.test(name));
}

function technologyOfUrl(value: string): Technology | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
  return scheme === undefined ? undefined : TECHNOLOGIES.find((technology) => technology.schemes.includes(scheme));
}

/** Hosts a configuration value points at: URLs ("postgres://u@db:5432/x") and host:port pairs ("kafka:9092,kafka2:9092"). */
function hostsIn(value: string): string[] {
  const urlHost = hostOf(value);
  if (urlHost !== null) return [urlHost];
  return value
    .split(",")
    .map((part) => /^([a-z][\w.-]*):\d+$/i.exec(part.trim())?.[1])
    .filter((host): host is string => host !== undefined);
}

function readCompose(design: DesignBuilder, path: string, text: string): void {
  const lines = new LineCounter();
  for (const document of parseAllDocuments(text, { lineCounter: lines })) {
    const services = document.get("services");
    if (!isMap(services)) continue;
    const lineOf = (node: unknown): number | null => (isScalar(node) && node.range ? lines.linePos(node.range[0]).line : null);
    const folder = dirname(path);

    for (const item of services.items) {
      const name = String(isScalar(item.key) ? item.key.value : item.key);
      if (!isMap(item.value)) continue;
      const service = item.value;
      const image = scalarString(service.get("image"));
      const build = service.get("build");
      const context = isMap(build) ? scalarString(build.get("context")) : scalarString(build);
      const technology = image === null ? undefined : technologyOfImage(image);
      // Built from a folder of this project (a build context outside the loaded folder is not ours to read).
      const rootPath = context === null ? null : resolveWithinRoot(folder === "" ? context : `${folder}/${context}`);
      const evidence: Evidence = { path, line: lineOf(item.key), note: image === null ? "compose service" : `compose service · image ${image}` };
      if (technology !== undefined) {
        design.component({ id: `svc:${name}`, name, kind: technology.kind, technology: technology.id, rootPath: null }, evidence);
      } else if (rootPath !== null) {
        design.component({ id: `svc:${name}`, name, kind: "service", technology: null, rootPath }, evidence);
      } else {
        design.component({ id: `svc:${name}`, name, kind: "service", technology: image, rootPath: null }, evidence);
      }
    }

    // Connections, once every service exists.
    for (const item of services.items) {
      if (!isMap(item.value)) continue;
      const from = `svc:${String(isScalar(item.key) ? item.key.value : item.key)}`;
      const dependsOn = item.value.get("depends_on", true);
      const dependencies = isSeq(dependsOn) ? dependsOn.items : isMap(dependsOn) ? dependsOn.items.map((pair) => pair.key) : [];
      for (const dependency of dependencies) {
        const target = design.find(`svc:${String(isScalar(dependency) ? dependency.value : dependency)}`);
        if (target !== undefined) design.connect(from, target.id, protocolOf(target), { path, line: lineOf(dependency), note: "depends_on" });
      }
      for (const { value, node } of environmentEntries(item.value)) {
        for (const host of hostsIn(value)) {
          const target = design.find(`svc:${host}`);
          if (target !== undefined) design.connect(from, target.id, technologyOfUrl(value)?.protocol ?? protocolOf(target), { path, line: lineOf(node), note: "connection setting" });
        }
      }
    }
  }
}

/** Environment values of a compose service or Kubernetes container, as list ("K=V") or map. */
function environmentEntries(container: YAMLMap): { value: string; node: YamlNode }[] {
  const environment = container.get("environment", true) ?? container.get("env", true);
  if (isSeq(environment)) {
    return environment.items.flatMap((entry) => {
      if (isScalar(entry)) {
        const text = String(entry.value);
        return [{ value: text.slice(text.indexOf("=") + 1), node: entry }];
      }
      if (isMap(entry)) {
        const value = entry.get("value", true); // Kubernetes: - name: X, value: Y
        return isScalar(value) ? [{ value: String(value.value), node: value }] : [];
      }
      return [];
    });
  }
  if (isMap(environment)) {
    return environment.items.flatMap((pair) => (isPair(pair) && isScalar(pair.value) ? [{ value: String(pair.value.value), node: pair.value }] : []));
  }
  return [];
}

function scalarString(node: unknown): string | null {
  if (typeof node === "string") return node;
  return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

function protocolOf(target: SystemComponent): string {
  const technology = TECHNOLOGIES.find((candidate) => candidate.id === target.technology);
  if (technology !== undefined) return technology.protocol;
  return target.kind === "frontend" || target.kind === "service" ? "HTTP" : "uses";
}

function readKubernetes(design: DesignBuilder, path: string, text: string): void {
  const lines = new LineCounter();
  const workloads: { name: string; containers: YAMLMap[]; line: number | null }[] = [];
  for (const document of parseAllDocuments(text, { lineCounter: lines })) {
    const kind = document.get("kind");
    if (typeof kind !== "string" || !WORKLOAD_KINDS.has(kind)) continue;
    const name = document.getIn(["metadata", "name"]);
    if (typeof name !== "string") continue;
    const podSpec = kind === "CronJob" ? ["spec", "jobTemplate", "spec", "template", "spec"] : ["spec", "template", "spec"];
    const containers = document.getIn([...podSpec, "containers"]);
    const nameNode = document.getIn(["metadata", "name"], true);
    workloads.push({
      name,
      containers: isSeq(containers) ? containers.items.filter((container): container is YAMLMap => isMap(container)) : [],
      line: isScalar(nameNode) && nameNode.range ? lines.linePos(nameNode.range[0]).line : null,
    });
  }
  for (const workload of workloads) {
    const image = workload.containers.map((container) => scalarString(container.get("image"))).find((candidate) => candidate !== null) ?? null;
    const technology = image === null ? undefined : technologyOfImage(image);
    const evidence: Evidence = { path, line: workload.line, note: `Kubernetes workload${image === null ? "" : ` · image ${image}`}` };
    design.component({ id: `svc:${workload.name}`, name: workload.name, kind: technology?.kind ?? "service", technology: technology?.id ?? image, rootPath: null }, evidence);
  }
  for (const workload of workloads) {
    for (const container of workload.containers) {
      for (const { value, node } of environmentEntries(container)) {
        for (const host of hostsIn(value)) {
          const target = design.find(`svc:${host.split(".")[0] ?? host}`); // "db.default.svc.cluster.local" -> db
          const line = isScalar(node) && node.range ? lines.linePos(node.range[0]).line : null;
          if (target !== undefined) design.connect(`svc:${workload.name}`, target.id, technologyOfUrl(value)?.protocol ?? protocolOf(target), { path, line, note: "connection setting" });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Manifests and code.

function readManifest(design: DesignBuilder, path: string, text: string): void {
  const root = dirname(path);
  const file = basename(path);
  const frameworks = FRAMEWORKS.filter((framework) => mentionsDependency(text, framework.name));
  const main = frameworks.find((framework) => framework.kind === "service") ?? frameworks.find((framework) => framework.kind === "frontend") ?? frameworks[0];
  const runtime = RUNTIME_BY_MANIFEST[file] ?? null;
  const evidence: Evidence = { path, line: null, note: main === undefined ? `${file}` : `${file} · depends on ${main.name}` };

  const existing = design.byRoot(root);
  if (existing !== undefined) {
    // A compose service built from this folder: the manifest says what kind of app it is.
    design.classify(existing.id, main?.kind ?? existing.kind, existing.technology ?? main?.label ?? runtime, evidence);
    return;
  }
  const packageName = file === "package.json" ? /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1] : undefined;
  const name = root === "" ? (packageName ?? "app") : basename(root);
  design.component({ id: `app:${root}`, name, kind: main?.kind ?? "service", technology: main?.label ?? runtime, rootPath: root }, evidence);
}

function mentionsDependency(manifest: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|[^\\w@/.-])${escaped}(?=[^\\w/-]|$)`, "m").test(manifest);
}

/** Client libraries and connection URLs in a file connect its app to data stores and brokers. */
function readClientUsage(design: DesignBuilder, app: SystemComponent, path: string, text: string): void {
  text.split("\n").forEach((line, index) => {
    for (const technology of TECHNOLOGIES) {
      if (!technology.clientPatterns.test(line)) continue;
      const evidence: Evidence = { path, line: index + 1, note: `uses ${technology.label}` };
      const target = design.forTechnology(technology, evidence);
      design.connect(app.id, target.id, technology.protocol, evidence);
    }
  });
}

/** An HTTP call connects its app to a named service, the app whose route it matches, or an external host. */
function connectHttpCall(design: DesignBuilder, appId: string, path: string, call: HttpCall, routes: Map<string, { path: string; route: Route }[]>): void {
  const host = hostOf(call.url);
  const evidence: Evidence = { path, line: call.line, note: `${call.method === "ANY" ? "calls" : call.method} ${call.url}` };
  const named = host === null ? undefined : design.find(`svc:${host}`);
  if (named !== undefined) {
    design.connect(appId, named.id, "HTTP", evidence);
    return;
  }
  if (host === null || LOCAL_HOSTS.has(host)) {
    for (const [targetId, served] of routes) {
      if (targetId === appId) continue;
      const match = served.find(({ route }) => routeMatches(route, call));
      if (match !== undefined) design.connect(appId, targetId, "HTTP", evidence, `${match.route.method === "ANY" ? "" : `${match.route.method} `}${match.route.path}`);
    }
    return;
  }
  const external = design.component({ id: `ext:${host}`, name: host, kind: "external", technology: null, rootPath: null }, evidence);
  design.connect(appId, external.id, call.url.startsWith("https") ? "HTTPS" : "HTTP", evidence);
}
