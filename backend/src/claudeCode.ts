import { execFile, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChatMessage, CodeAccess, ToolCall, ToolDefinition } from "./modelProvider.js";
import { addUsage } from "./usage.js";

const execFileAsync = promisify(execFile);

// Model calls through Claude Code's headless mode (`claude -p`), using the
// reviewer's own Claude Code login - for when running a local model isn't
// practical. Each call is prompt in, answer out:
// - no tools and no MCP servers, so it can't read or change anything -
//   except, where a call asks, Docent's own read-only tools;
// - only local settings, from an empty working folder, so the reviewer's
//   plugins, hooks and CLAUDE.md files stay out of it (and it starts in a few
//   seconds rather than ten or more);
// - not --bare, which would skip the reviewer's login and need an API key.

// Claude Code's model aliases; it has no command to list models.
export const CLAUDE_CODE_MODELS = ["opus", "sonnet", "haiku"];

let available: Promise<boolean> | null = null;

// Whether `claude` is on the PATH, checked once.
export function claudeCodeAvailable(): Promise<boolean> {
  available ??= execFileAsync("claude", ["--version"]).then(
    () => true,
    () => false,
  );
  return available;
}

const workDir = join(tmpdir(), "docent-claude-code");

interface HeadlessResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: Parameters<typeof addUsage>[0];
}

function run(
  model: string,
  messages: ChatMessage[],
  schema: object | undefined,
  signal?: AbortSignal,
  access?: CodeAccess,
): Promise<HeadlessResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system");
  // A single request goes in as it is; a conversation (a thread with
  // follow-ups) goes in as a transcript, answering its last message.
  const prompt =
    turns.length === 1
      ? turns[0].content
      : `${turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n\nReply to the user's last message as the assistant.`;

  // Streamed when someone wants to see each look it takes.
  const streaming = !!access?.onStep;
  const args = [
    "-p",
    "--output-format",
    ...(streaming ? ["stream-json", "--verbose"] : ["json"]),
    "--model",
    model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "local",
    "--no-session-persistence",
    ...(system ? ["--system-prompt", system] : []),
    ...(schema ? ["--json-schema", JSON.stringify(schema)] : []),
    ...(access
      ? [
          "--mcp-config",
          JSON.stringify({ mcpServers: { docent: { type: "http", url: access.mcpUrl } } }),
          "--allowedTools",
          ...access.tools.map((t) => `mcp__docent__${t}`),
        ]
      : []),
  ];

  mkdirSync(workDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: workDir, signal });
    let stdout = "";
    let stderr = "";
    let pending = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!streaming) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) reportSteps(line, access!.onStep!);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        // Streamed, the answer is the last line: the result.
        const result = JSON.parse(streaming ? (stdout.trim().split("\n").at(-1) ?? "") : stdout) as HeadlessResult;
        addUsage(result.usage);
        resolve(result);
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || `claude exited with ${code}`));
      }
    });
    child.stdin.end(prompt);
  });
}

// The looks a streamed line records, in words.
function reportSteps(line: string, onStep: (step: string) => void) {
  let event: { type?: string; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } };
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (event.type !== "assistant") return;
  for (const part of event.message?.content ?? []) {
    if (part.type !== "tool_use" || !part.name?.startsWith("mcp__docent__")) continue;
    const input = part.input ?? {};
    const text = (key: string) => (typeof input[key] === "string" && (input[key] as string).trim()) || "";
    const tool = part.name.slice("mcp__docent__".length);
    const step =
      tool === "read_file"
        ? `Read ${text("path")}${typeof input.start_line === "number" ? ` from line ${input.start_line}` : ""}`
        : tool === "list_files"
          ? `Listed ${text("directory") || "the repo"}`
          : tool === "search_code"
            ? `Searched ${text("directory") || "the repo"} for ${text("pattern")}`
            : tool === "get_diff"
              ? `Read the diff${text("path") ? ` of ${text("path")}` : ""}`
              : tool;
    onStep(step);
  }
}

export async function claudeCodeChatWithTool(
  model: string,
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
  access?: CodeAccess,
): Promise<ToolCall> {
  const result = await run(model, messages, tool.parameters, signal, access);
  if (result.is_error) throw new Error(`Claude Code: ${result.result ?? "the call failed"}`);
  if (typeof result.structured_output !== "object" || result.structured_output === null) {
    throw new Error("Claude Code didn't return the structured answer asked for");
  }
  return { name: tool.name, arguments: result.structured_output };
}

export async function claudeCodeChat(model: string, messages: ChatMessage[], signal?: AbortSignal, access?: CodeAccess): Promise<string> {
  const result = await run(model, messages, undefined, signal, access);
  if (result.is_error) throw new Error(`Claude Code: ${result.result ?? "the call failed"}`);
  const text = result.result?.trim();
  if (!text) throw new Error("Claude Code returned an empty reply");
  return text;
}
