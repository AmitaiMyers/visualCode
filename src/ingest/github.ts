import type { FileDiff, Project, SourceFile } from "../model/types";
import { makeFileDiff } from "../diff/unifiedDiff";
import { MAX_FILES, MAX_FILE_BYTES, isSupportedSourcePath } from "../parse/language";
import { at } from "../util/assert";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const FETCH_CONCURRENCY = 8;
const MAX_PR_FILES = 3000; // GitHub's own limit for the PR files endpoint

export type GitHubTarget =
  | { kind: "repo"; owner: string; repo: string; ref: string | null; subPath: string }
  | { kind: "pull"; owner: string; repo: string; number: number };

/**
 * Accepts https://github.com/owner/repo, .../tree/<ref>/<sub/path> and .../pull/<n>.
 * Refs that contain "/" are not supported in tree URLs (the first segment is taken as the ref).
 */
export function parseGitHubUrl(input: string): GitHubTarget {
  const trimmed = input.trim();
  const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (url.hostname !== "github.com") {
    throw new Error(`Not a github.com URL: ${input}`);
  }
  const [owner, rawRepo, section, ...rest] = url.pathname.split("/").filter((part) => part !== "");
  if (owner === undefined || rawRepo === undefined) {
    throw new Error("Expected https://github.com/<owner>/<repo>");
  }
  const repo = rawRepo.replace(/\.git$/, "");
  if (section === "pull") {
    const number = Number(rest[0]);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid pull request number in ${input}`);
    return { kind: "pull", owner, repo, number };
  }
  if (section === "tree" || section === "blob") {
    return { kind: "repo", owner, repo, ref: at(rest, 0, "ref in URL"), subPath: rest.slice(1).join("/") };
  }
  if (section !== undefined) {
    throw new Error(`Unsupported GitHub URL section "${section}". Use a repo, /tree/<ref>/<path> or /pull/<n> URL.`);
  }
  return { kind: "repo", owner, repo, ref: null, subPath: "" };
}

export interface LoadProgress {
  message: string;
  fraction: number | null; // 0..1 when the amount of work is known
}

export type ProgressListener = (progress: LoadProgress) => void;

export async function loadFromGitHub(input: string, token: string, onProgress: ProgressListener): Promise<Project> {
  const target = parseGitHubUrl(input);
  const client = new GitHubClient(token);
  if (target.kind === "pull") {
    return loadPullRequest(client, target, onProgress);
  }
  const ref = target.ref ?? (await client.json<{ default_branch: string }>(`/repos/${target.owner}/${target.repo}`)).default_branch;
  const files = await loadTree(client, target.owner, target.repo, ref, target.subPath, onProgress);
  const scope = target.subPath === "" ? "" : `/${target.subPath}`;
  return {
    id: `github:${target.owner}/${target.repo}@${ref}${scope}`,
    title: `${target.repo}${scope}`,
    files,
    diff: [],
  };
}

interface PullRequestInfo {
  title: string;
  head: { sha: string; repo: { full_name: string } | null };
}

interface PullRequestFile {
  filename: string;
  previous_filename?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  patch?: string;
}

async function loadPullRequest(
  client: GitHubClient,
  target: Extract<GitHubTarget, { kind: "pull" }>,
  onProgress: ProgressListener,
): Promise<Project> {
  const base = `/repos/${target.owner}/${target.repo}`;
  onProgress({ message: `Reading pull request #${target.number}…`, fraction: null });
  const pull = await client.json<PullRequestInfo>(`${base}/pulls/${target.number}`);
  if (pull.head.repo === null) {
    throw new Error("The pull request's source repository was deleted, so its code cannot be loaded.");
  }
  const fullName = pull.head.repo.full_name.split("/");
  const headOwner = at(fullName, 0, "head repo owner");
  const headRepo = at(fullName, 1, "head repo name");
  const changedFiles = await client.paged<PullRequestFile>(`${base}/pulls/${target.number}/files`, MAX_PR_FILES);
  const diff = changedFiles.map(toFileDiff);
  // Load the whole code base at the PR head so the map shows changes in context.
  const files = await loadTree(client, headOwner, headRepo, pull.head.sha, "", onProgress);
  return {
    id: `github:${target.owner}/${target.repo}#${target.number}@${pull.head.sha}`,
    title: `${target.repo} #${target.number}: ${pull.title}`,
    files,
    diff,
  };
}

function toFileDiff(file: PullRequestFile): FileDiff {
  const patch = file.patch ?? ""; // GitHub omits patches for binary or very large files
  switch (file.status) {
    case "added":
    case "copied":
      return makeFileDiff(file.filename, null, "added", patch);
    case "removed":
      return makeFileDiff(file.filename, null, "deleted", patch);
    case "renamed":
      return makeFileDiff(file.filename, file.previous_filename ?? null, "renamed", patch);
    case "modified":
    case "changed":
    case "unchanged":
      return makeFileDiff(file.filename, null, "modified", patch);
  }
}

interface TreeResponse {
  truncated: boolean;
  tree: { path: string; type: "blob" | "tree" | "commit"; size?: number }[];
}

async function loadTree(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
  subPath: string,
  onProgress: ProgressListener,
): Promise<SourceFile[]> {
  onProgress({ message: `Listing files of ${owner}/${repo}…`, fraction: null });
  const tree = await client.json<TreeResponse>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (tree.truncated) {
    throw new Error("This repository is too large for one listing. Load a sub-folder URL (…/tree/<branch>/<folder>) instead.");
  }
  const prefix = subPath === "" ? "" : `${subPath.replace(/\/$/, "")}/`;
  const entries = tree.tree.filter(
    (entry) =>
      entry.type === "blob" &&
      entry.path.startsWith(prefix) &&
      isSupportedSourcePath(entry.path) &&
      (entry.size ?? 0) <= MAX_FILE_BYTES,
  );
  if (entries.length === 0) {
    throw new Error("No JavaScript, TypeScript or Python files found at this location.");
  }
  if (entries.length > MAX_FILES) {
    throw new Error(`Found ${entries.length} source files (limit ${MAX_FILES}). Load a sub-folder URL instead.`);
  }

  let done = 0;
  return mapWithConcurrency(entries, FETCH_CONCURRENCY, async (entry) => {
    const content = await client.raw(owner, repo, ref, entry.path);
    done += 1;
    onProgress({ message: `Downloading ${done} / ${entries.length} files…`, fraction: done / entries.length });
    return { path: entry.path, content };
  });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(at(items, index, "work item"));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

class GitHubClient {
  constructor(private readonly token: string) {}

  async json<T>(path: string): Promise<T> {
    const response = await this.request(`${API}${path}`);
    return (await response.json()) as T;
  }

  /** Follows page=N until a short page arrives. */
  async paged<T>(path: string, maxItems: number): Promise<T[]> {
    const perPage = 100;
    const items: T[] = [];
    for (let page = 1; items.length < maxItems; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await this.json<T[]>(`${path}${separator}per_page=${perPage}&page=${page}`);
      items.push(...batch);
      if (batch.length < perPage) break;
    }
    return items;
  }

  async raw(owner: string, repo: string, ref: string, path: string): Promise<string> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${encodedPath}`);
    if (!response.ok) {
      throw new Error(`Could not download ${path} (HTTP ${response.status}). Only public repositories are supported.`);
    }
    return response.text();
  }

  private async request(url: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (this.token !== "") headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(url, { headers });
    if (response.ok) return response;
    if (response.status === 403 || response.status === 429) {
      throw new Error("GitHub rate limit reached. Add a GitHub token in Settings, or wait and try again.");
    }
    if (response.status === 404) {
      throw new Error("Not found on GitHub. Check the URL; only public repositories are supported.");
    }
    throw new Error(`GitHub request failed (HTTP ${response.status}) for ${url}`);
  }
}
