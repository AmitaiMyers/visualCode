import { beforeEach, describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../diff/unifiedDiff";
import { DEMO_DIFF, DEMO_FILES } from "../demo/sampleProject";
import { aiRequestFor } from "../ai/claude";
import { fileId, symbolId } from "../model/ids";
import { DEFAULT_SETTINGS, clearSettings, loadSettings, persistSettings } from "../settings";
import { PROJECT_KEYS } from "../privacy/localData";
import { analyze } from "./fixtures";

/** Web Storage for the tests, which run outside a browser. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe("key storage", () => {
  beforeEach(() => {
    Object.assign(globalThis, { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
  });

  it("keeps keys in the tab by default, never on the device", () => {
    persistSettings({ ...DEFAULT_SETTINGS, claudeApiKey: "sk-ant-x" });
    expect(sessionStorage.getItem("visualcode:settings")).toContain("sk-ant-x");
    expect(localStorage.getItem("visualcode:settings")).toBeNull();
    expect(loadSettings()).toMatchObject({ claudeApiKey: "sk-ant-x", keyStorage: "tab" });
  });

  it("moves keys between tab and device without leaving a copy behind", () => {
    persistSettings({ ...DEFAULT_SETTINGS, githubToken: "ghp_x", keyStorage: "device" });
    expect(localStorage.getItem("visualcode:settings")).toContain("ghp_x");
    persistSettings({ ...DEFAULT_SETTINGS, githubToken: "ghp_x", keyStorage: "tab" });
    expect(localStorage.getItem("visualcode:settings")).toBeNull();
    expect(sessionStorage.getItem("visualcode:settings")).toContain("ghp_x");
  });

  it("forgets keys and preferences when cleared", () => {
    persistSettings({ ...DEFAULT_SETTINGS, claudeApiKey: "sk-ant-x", keyStorage: "device", theme: "dark" });
    clearSettings();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("AI requests", () => {
  const analysis = analyze(DEMO_FILES, parseUnifiedDiff(DEMO_DIFF));

  it("list the code they contain, so the reader can see it before sending", () => {
    const block = analysis.graph.nodes.get(symbolId("src/checkout/payment.ts", "chargeCard"))!;
    expect(aiRequestFor(analysis, block, "review").includes).toEqual(["src/checkout/payment.ts, lines 3–7", "the diff of src/checkout/payment.ts"]);
    const unchanged = analysis.graph.nodes.get(fileId("src/util/format.ts"))!;
    expect(aiRequestFor(analysis, unchanged, "explain").includes).toEqual(["src/util/format.ts (whole file)"]);
  });

  it("say when a deleted block's old version is sent", () => {
    const removed = analysis.graph.nodes.get(symbolId("src/checkout/payment.ts", "logCharge"))!;
    expect(aiRequestFor(analysis, removed, "explain").includes[0]).toMatch(/of the old version$/);
  });
});

describe("project data keys", () => {
  it("are distinct per project and per kind of data", () => {
    const keys = Object.values(PROJECT_KEYS).flatMap((key) => [key("a"), key("b")]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
