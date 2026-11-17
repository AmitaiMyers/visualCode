import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "../ingest/github";

describe("parseGitHubUrl", () => {
  it("reads repo, tree and pull request URLs", () => {
    expect(parseGitHubUrl("https://github.com/acme/app")).toEqual({ kind: "repo", owner: "acme", repo: "app", ref: null, subPath: "" });
    expect(parseGitHubUrl("https://github.com/acme/app.git")).toMatchObject({ repo: "app" });
    expect(parseGitHubUrl("https://github.com/acme/app/tree/main/src/core")).toEqual({
      kind: "repo",
      owner: "acme",
      repo: "app",
      ref: "main",
      subPath: "src/core",
    });
    expect(parseGitHubUrl("https://github.com/acme/app/pull/42/files")).toEqual({ kind: "pull", owner: "acme", repo: "app", number: 42 });
  });

  it("rejects other hosts and unsupported sections", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/acme/app")).toThrow(/github.com/);
    expect(() => parseGitHubUrl("https://github.com/acme/app/issues/1")).toThrow(/Unsupported/);
    expect(() => parseGitHubUrl("https://github.com/acme/app/pull/abc")).toThrow(/pull request number/);
  });
});
