import type { Analysis } from "../analysis/analyze";
import { symbolLines } from "../analysis/source";
import type { CodeNode } from "../model/types";

const MODEL = "claude-opus-5-5";
const MAX_SOURCE_CHARS = 60_000; // keep prompts bounded for very large files

export type AiTask = "explain" | "review";

const SYSTEM_PROMPT =
  "You help developers read and review code that is shown as a storyline of blocks " +
  "(functions, classes and module-level sections) ordered by how the logic flows. " +
  "Be concrete and brief. Refer to blocks by name. Use short Markdown bullet lists.";

/**
 * Asks Claude about one block/file, using the key the user pasted in Settings.
 * The key is sent straight from the browser to the Anthropic API.
 */
export async function askClaude(apiKey: string, analysis: Analysis, node: CodeNode, task: AiTask): Promise<string> {
  return completeWithClaude(apiKey, SYSTEM_PROMPT, buildPrompt(analysis, node, task));
}

/** One request to Claude with the reader's key; returns the answer's text, or throws on a refusal or an empty answer. */
export async function completeWithClaude(apiKey: string, system: string, prompt: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    // If the model declines for policy reasons, let the API retry on its default fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to answer this request.");
  }
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim();
  if (text === "") {
    throw new Error(`Claude returned no text (stop reason: ${response.stop_reason ?? "unknown"}).`);
  }
  return text;
}

function buildPrompt(analysis: Analysis, node: CodeNode, task: AiTask): string {
  const filePath = node.path;
  const source = sourceFor(analysis, node);
  const diff = analysis.diffByPath.get(filePath);
  const change = analysis.changes.get(node.id);
  const instruction =
    task === "explain"
      ? "Explain what this code does and how it fits into the flow: its inputs, what it calls, and what it returns or changes. Max 6 bullets."
      : "Review this code as a careful senior engineer. List concrete problems (bugs, edge cases, unclear naming, missing error handling) with the block name for each. If the diff is given, focus on the changed lines. Max 6 bullets. Say 'No issues found' if there are none.";
  const parts = [
    `${instruction}`,
    `Location: ${describeNode(node)}`,
    change && change.status !== null ? `Change status: ${change.status}` : "",
    node.symbol !== null && node.symbol.origin === "removed" ? "This block was deleted by the change; the source below is its old version." : "",
    `<source path="${filePath}">\n${source}\n</source>`,
    diff && diff.patch !== "" ? `<diff path="${filePath}">\n${truncate(diff.patch)}\n</diff>` : "",
  ];
  return parts.filter((part) => part !== "").join("\n\n");
}

function describeNode(node: CodeNode): string {
  if (node.symbol === null) return `${node.kind} ${node.path}`;
  const { symbol } = node;
  return `${symbol.kind} ${symbol.qualifiedName} in ${symbol.filePath}, lines ${symbol.startLine}-${symbol.endLine}`;
}

function sourceFor(analysis: Analysis, node: CodeNode): string {
  if (node.kind === "folder") {
    throw new Error("AI actions work on files and code blocks, not folders.");
  }
  if (node.symbol !== null) return truncate(symbolLines(analysis, node.symbol).join("\n"));
  const content = analysis.contents.get(node.path);
  return content === undefined ? "(file deleted in this change)" : truncate(content);
}

function truncate(text: string): string {
  return text.length <= MAX_SOURCE_CHARS ? text : `${text.slice(0, MAX_SOURCE_CHARS)}\n… (truncated)`;
}
