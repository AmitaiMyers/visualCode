/**
 * HTTP routes a service defines and HTTP calls code makes, read line by line with the conventions of
 * common frameworks and clients. Calls are matched to routes by path to connect apps.
 */

export interface Route {
  method: string; // upper case; "ANY" when the framework does not say
  path: string;
  line: number;
}

export interface HttpCall {
  method: string; // upper case; "ANY" when the client call does not say
  url: string; // as written, with ${…} / {…} expressions kept
  line: number;
}

const ROUTE_PATTERNS: { pattern: RegExp; method: (match: RegExpExecArray) => string; path: (match: RegExpExecArray) => string }[] = [
  // express, fastify, koa-router, hono: app.get("/x", …). Not api.get: that is usually an HTTP client instance.
  { pattern: /\b(?:app|router|server|route[rs]?)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/i, method: (m) => verb(m[1]), path: (m) => text(m[2]) },
  // flask: @app.route("/x", methods=["POST"])
  { pattern: /@\w+\.route\(\s*["'](\/[^"']*)["'](?:.*methods\s*=\s*\[\s*["'](\w+)["'])?/, method: (m) => verb(m[2]), path: (m) => text(m[1]) },
  // fastapi, flask 2: @app.get("/x")
  { pattern: /@\w+\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/, method: (m) => verb(m[1]), path: (m) => text(m[2]) },
  // spring: @GetMapping("/x"), @RequestMapping(value = "/x")
  { pattern: /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:(?:value|path)\s*=\s*)?["'](\/[^"']*)["']/, method: (m) => verb(m[1] === "Request" ? undefined : m[1]), path: (m) => text(m[2]) },
  // gin, echo, chi, gorilla: r.GET("/x", …), e.POST(…), r.HandleFunc("/x", …)
  { pattern: /\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|HandleFunc|Handle)\(\s*"(\/[^"]*)"/, method: (m) => verb(m[1]?.startsWith("Handle") ? undefined : m[1]), path: (m) => text(m[2]) },
  // rails: get "/x", to: …
  { pattern: /^\s*(get|post|put|patch|delete)\s+["'](\/[^"']*)["']/, method: (m) => verb(m[1]), path: (m) => text(m[2]) },
];

const CALL_PATTERNS: { pattern: RegExp; method: (match: RegExpExecArray, line: string) => string; url: (match: RegExpExecArray) => string }[] = [
  // fetch("/x", { method: "POST" })
  { pattern: /\bfetch\(\s*(["'`])(.+?)\1/, method: (_, line) => verb(/method:\s*["'](\w+)["']/.exec(line)?.[1]), url: (m) => text(m[2]) },
  // axios.post("/x"), http.get("/x") (Angular HttpClient), ky.get("/x")
  { pattern: /\b(?:axios|http|httpClient|this\.http|ky|client|api)\.(get|post|put|patch|delete)\(\s*(["'`])(.+?)\2/, method: (m) => verb(m[1]), url: (m) => text(m[3]) },
  // requests.get("…"), httpx.post(f"…")
  { pattern: /\b(?:requests|httpx|session)\.(get|post|put|patch|delete)\(\s*f?(["'])(.+?)\2/, method: (m) => verb(m[1]), url: (m) => text(m[3]) },
  // Go: http.Get("…"), http.Post("…"), http.NewRequest("POST", "…")
  { pattern: /\bhttp\.(Get|Post|Head)\(\s*"([^"]+)"/, method: (m) => verb(m[1]), url: (m) => text(m[2]) },
  { pattern: /\bhttp\.NewRequest(?:WithContext)?\([^"]*"(\w+)",\s*"([^"]+)"/, method: (m) => verb(m[1]), url: (m) => text(m[2]) },
];

function text(value: string | undefined): string {
  if (value === undefined) throw new Error("Pattern group missing");
  return value;
}

function verb(value: string | undefined): string {
  return value === undefined || value.toLowerCase() === "all" ? "ANY" : value.toUpperCase();
}

function scan<T>(content: string, read: (line: string, lineNumber: number) => T | null): T[] {
  return content.split("\n").flatMap((line, index) => {
    const found = read(line, index + 1);
    return found === null ? [] : [found];
  });
}

export function findRoutes(content: string): Route[] {
  return scan(content, (line, lineNumber) => {
    for (const { pattern, method, path } of ROUTE_PATTERNS) {
      const match = pattern.exec(line);
      if (match) return { method: method(match), path: path(match), line: lineNumber };
    }
    return null;
  });
}

export function findHttpCalls(content: string): HttpCall[] {
  return scan(content, (line, lineNumber) => {
    for (const { pattern, method, url } of CALL_PATTERNS) {
      const match = pattern.exec(line);
      if (match) return { method: method(match, line), url: url(match), line: lineNumber };
    }
    return null;
  });
}

/** The host of an absolute URL ("https://api.stripe.com/v1" → "api.stripe.com"), or null for a path. */
export function hostOf(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(url);
  return match === null ? null : text(match[1]);
}

/** The path part of a call URL, with template expressions as wildcards: "${base}/api/x/${id}" → "/api/x/*". */
export function callPath(url: string): string | null {
  const withoutTemplates = url.replace(/\$\{[^}]*\}|\{[^}]*\}/g, "*");
  const withoutOrigin = withoutTemplates.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").replace(/^\*(?=\/)/, "");
  const path = withoutOrigin.split(/[?#]/)[0] ?? "";
  return path.startsWith("/") ? path : null;
}

/** True when a call path can reach a route: segments match one by one; ":id", "{id}", "<id>" and "*" match anything. */
export function routeMatches(route: Route, call: HttpCall): boolean {
  if (route.method !== "ANY" && call.method !== "ANY" && route.method !== call.method) return false;
  const path = callPath(call.url);
  if (path === null) return false;
  const routeSegments = segments(route.path);
  const callSegments = segments(path);
  if (routeSegments.length !== callSegments.length) return false;
  return routeSegments.every((segment, index) => {
    const other = callSegments[index];
    return isWildcard(segment) || other === "*" || segment === other;
  });
}

function segments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function isWildcard(segment: string): boolean {
  return segment === "*" || segment.startsWith(":") || /^\{.*\}$/.test(segment) || /^<.*>$/.test(segment);
}
