import type { Analysis } from "../analysis/analyze";
import type { CodeGraph } from "../model/types";
import { blockAtLine, declaredBlocks } from "../graph/blocks";
import type { AiRequest } from "../ai/claude";
import { languageOf } from "../parse/language";
import { basename, dirname } from "../util/paths";
import { mustGet } from "../util/assert";
import { technologyById, type PlanLanguage, type Technology } from "./catalog";
import { findRoutes } from "./http";
import type { SystemComponent, SystemDesign } from "./model";

const MAX_TOUCH_POINTS = 8;
const COMPOSE_FILE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const EXTENSION: Record<PlanLanguage, string> = { ts: "ts", py: "py", go: "go", java: "java" };
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A code block the change should touch, and why. */
export interface TouchPoint {
  nodeId: string;
  label: string;
  path: string;
  line: number;
  reason: string;
}

export interface PlanSnippet {
  file: string; // where it goes
  language: string; // for display: "yaml", "dotenv", "shell", or a plan language
  text: string;
}

export interface PlanStep {
  title: string;
  detail: string;
  snippets: PlanSnippet[];
  touchPoints: TouchPoint[];
}

export interface IntegrationPlan {
  technology: Technology;
  app: SystemComponent;
  language: PlanLanguage;
  steps: PlanStep[];
}

/** The plan languages an app is written in, most files first. */
export function appLanguages(analysis: Analysis, app: SystemComponent): PlanLanguage[] {
  const counts = new Map<PlanLanguage, number>();
  for (const path of filesOf(analysis, app)) {
    const language = planLanguageOf(path);
    if (language !== null) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language]) => language);
}

function planLanguageOf(path: string): PlanLanguage | null {
  const language = languageOf(path);
  if (language === "ts" || language === "py" || language === "go" || language === "java") return language;
  return language === "kotlin" ? "java" : null;
}

/** Files of an app: under its folder, and not inside a more specific app's folder. */
function filesOf(analysis: Analysis, app: SystemComponent): string[] {
  if (app.rootPath === null) return [];
  const root = app.rootPath;
  return [...analysis.contents.keys()].filter((path) => root === "" || path.startsWith(`${root}/`));
}

/**
 * The deterministic guide for adding a technology to an app: the package, a compose service, the
 * connection settings, the client code, and the blocks of this project's code where it is used.
 */
export function buildIntegrationPlan(analysis: Analysis, design: SystemDesign, technologyId: string, app: SystemComponent, language: PlanLanguage): IntegrationPlan {
  const technology = technologyById(technologyId);
  const guide = technology.guide;
  if (guide === null) throw new Error(`${technology.label} has no integration guide`);
  if (app.rootPath === null) throw new Error(`${app.name} is not an app built from this project's code`);
  const root = app.rootPath;
  const inRoot = (name: string): string => (root === "" ? name : `${root}/${name}`);
  const client = guide.clients[language];
  const serviceName = /^\s{2}([\w-]+):/.exec(guide.composeService)?.[1] ?? technology.id;

  const composePath = [...analysis.contents.keys()].find((path) => COMPOSE_FILE.test(path));
  const appService = app.id.startsWith("svc:") ? app.name : null;
  const composeSnippet: PlanSnippet =
    composePath === undefined
      ? { file: "docker-compose.yml", language: "yaml", text: `services:\n${guide.composeService}${volumesBlock(guide.volume)}` }
      : { file: composePath, language: "yaml", text: `# under services:\n${guide.composeService}${volumesBlock(guide.volume)}` };
  const dependsSnippet: PlanSnippet[] =
    appService === null || composePath === undefined
      ? []
      : [
          {
            file: composePath,
            language: "yaml",
            text: `  ${appService}:\n    depends_on:\n      - ${serviceName}\n    environment:\n${guide.env.map((setting) => `      ${setting.name}: ${setting.compose}`).join("\n")}`,
          },
        ];

  const envPath = [...analysis.contents.keys()].find((path) => dirname(path) === root && /^\.env\.(example|sample)$/.test(basename(path))) ?? inRoot(".env.example");
  const dataAccess = dataAccessPoints(analysis, design, app);
  // The client module lives next to the existing data access, or in the app's src/ folder.
  const clientFolder = dataAccess[0] === undefined ? inRoot("src") : dirname(dataAccess[0].path);
  const clientName = `${technology.id}.${EXTENSION[language]}`;
  const clientFile = clientFolder === "" ? clientName : `${clientFolder}/${clientName}`;

  const steps: PlanStep[] = [
    { title: "Add the client library", detail: `${technology.label} client for ${app.name}.`, snippets: [{ file: inRoot(""), language: "shell", text: client.install }], touchPoints: [] },
    {
      title: "Run it next to the app",
      detail: composePath === undefined ? "There is no compose file yet; this one runs the new service locally." : `Add the service to ${composePath}${appService === null ? "" : ` and make ${appService} wait for it`}.`,
      snippets: [composeSnippet, ...dependsSnippet],
      touchPoints: [],
    },
    {
      title: "Configure the connection",
      detail: "The app reads its connection settings from the environment. Inside compose the host is the service name; on your machine it is localhost.",
      snippets: [{ file: envPath, language: "dotenv", text: guide.env.map((setting) => `${setting.name}=${setting.local}`).join("\n") }],
      touchPoints: [],
    },
    {
      title: "Create the client",
      detail: dataAccess[0] === undefined ? "One module creates the client; the rest of the code imports it." : `Next to the existing data access in ${dataAccess[0].path}.`,
      snippets: [{ file: clientFile, language, text: client.init }],
      touchPoints: [],
    },
    { title: "Use it in the code", detail: guide.usage, snippets: [], touchPoints: touchPoints(analysis, technology, app, dataAccess) },
  ];
  if (guide.caveat !== null) steps.push({ title: "Before production", detail: guide.caveat, snippets: [], touchPoints: [] });
  return { technology, app, language, steps };
}

function volumesBlock(volume: string | null): string {
  return volume === null ? "" : `\n\n# at the top level of the file:\nvolumes:\n  ${volume}:`;
}

/** Functions in the app's files that talk to a database (the files where its client is used): where reads and writes happen. */
function dataAccessPoints(analysis: Analysis, design: SystemDesign, app: SystemComponent): TouchPoint[] {
  const databases = new Set(design.components.filter((component) => component.kind === "database").map((component) => component.id));
  const files = new Set(
    design.connections
      .filter((connection) => connection.from === app.id && databases.has(connection.to))
      .flatMap((connection) => connection.evidence)
      .filter((evidence) => planLanguageOf(evidence.path) !== null)
      .map((evidence) => evidence.path),
  );
  const points = [...files].flatMap((path) =>
    declaredBlocks(analysis.graph, path).map((block) => ({ nodeId: block.id, label: block.qualifiedName, path, line: block.startLine, reason: "talks to the database" })),
  );
  return unique(points);
}

/** Route handlers of the app, write routes first when asked. */
function routePoints(analysis: Analysis, app: SystemComponent, writesOnly: boolean): TouchPoint[] {
  const points = filesOf(analysis, app).flatMap((path) =>
    findRoutes(mustGet(analysis.contents, path, "File content"))
      .filter((route) => !writesOnly || WRITE_METHODS.has(route.method))
      .flatMap((route) => blockPoint(analysis.graph, path, route.line, `handles ${route.method === "ANY" ? "" : `${route.method} `}${route.path}`)),
  );
  return unique(points);
}

function touchPoints(analysis: Analysis, technology: Technology, app: SystemComponent, dataAccess: TouchPoint[]): TouchPoint[] {
  const withReason = (points: TouchPoint[], reason: string): TouchPoint[] => points.map((point) => ({ ...point, reason: `${point.reason} · ${reason}` }));
  switch (technology.kind) {
    case "cache":
      return dataAccess.length > 0 ? withReason(dataAccess, "cache its reads, invalidate on writes") : withReason(routePoints(analysis, app, false), "cache the response");
    case "queue": {
      const writes = routePoints(analysis, app, true);
      return writes.length > 0 ? withReason(writes, "publish an event after the write") : withReason(dataAccess, "publish an event after the write");
    }
    case "storage": {
      const uploads = filesOf(analysis, app).flatMap((path) =>
        mustGet(analysis.contents, path, "File content")
          .split("\n")
          .flatMap((line, index) => (/\b(upload|multipart|multer|attachment|UploadFile)\b/i.test(line) ? blockPoint(analysis.graph, path, index + 1, "handles files") : [])),
      );
      return uploads.length > 0 ? withReason(unique(uploads), "store the file in the bucket") : withReason(routePoints(analysis, app, true), "store files here");
    }
    default:
      return withReason(routePoints(analysis, app, false), "read and write through the new data-access module");
  }
}

/** The block that holds a line, as a touch point. */
function blockPoint(graph: CodeGraph, path: string, line: number, reason: string): TouchPoint[] {
  const block = blockAtLine(graph, path, line);
  if (block === null) return [];
  return [{ nodeId: block.id, label: block.kind === "section" ? block.name : block.qualifiedName, path, line, reason }];
}

function unique(points: TouchPoint[]): TouchPoint[] {
  const byNode = new Map<string, TouchPoint>();
  for (const point of points) {
    if (!byNode.has(point.nodeId)) byNode.set(point.nodeId, point);
  }
  return [...byNode.values()].slice(0, MAX_TOUCH_POINTS);
}

/** The request for an optional Claude draft: the plan plus the source of every touch point. */
export function draftRequest(analysis: Analysis, plan: IntegrationPlan): AiRequest {
  const touch = plan.steps.flatMap((step) => step.touchPoints);
  const sources = touch.map((point) => {
    const symbol = mustGet(analysis.graph.nodes, point.nodeId, "Touch point").symbol;
    if (symbol === null) throw new Error(`Touch point is not a block: ${point.nodeId}`);
    const lines = mustGet(analysis.contents, symbol.filePath, "File content").split("\n").slice(symbol.startLine - 1, symbol.endLine);
    return `<block name="${point.label}" path="${symbol.filePath}" lines="${symbol.startLine}-${symbol.endLine}" why="${point.reason}">\n${lines.join("\n")}\n</block>`;
  });
  const steps = plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}${step.snippets.map((snippet) => `\n--- ${snippet.file}\n${snippet.text}`).join("")}`);
  const prompt = [
    `Add ${plan.technology.label} to the app "${plan.app.name}" (${plan.language}). Follow this plan:`,
    steps.join("\n\n"),
    touch.length === 0 ? "No existing blocks were found to change; propose where the new code goes." : `Change these blocks:\n\n${sources.join("\n\n")}`,
    "Reply with the changed blocks in full, each as a fenced code block preceded by its file path and block name, then a short list of what to test.",
  ].join("\n\n");
  const includes = ["the integration plan (generated, no project code)", ...touch.map((point) => `${point.path}: ${point.label}`)];
  return { system: DRAFT_SYSTEM_PROMPT, prompt, includes };
}

const DRAFT_SYSTEM_PROMPT =
  "You are a senior engineer adding infrastructure to an existing codebase. Change as little as possible, keep the project's style, " +
  "read configuration from the environment, and fail with a clear error when a setting is missing.";
