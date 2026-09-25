import { execFile, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChatMessage, ToolCall, ToolDefinition } from "./modelProvider.js";
import { addUsage } from "./usage.js";

const execFileAsync = promisify(execFile);

// Model calls through Claude Code's headless mode (`claude -p`), using the
// reviewer's own Claude Code login - for when running a local model isn't
// practical. Each call is prompt in, answer out:
// - no tools and no MCP servers, so it can't read or change anything;
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

function run(model: string, messages: ChatMessage[], schema: object | undefined, signal?: AbortSignal): Promise<HeadlessResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system");
  // A single request goes in as it is; a conversation (a thread with
  // follow-ups) goes in as a transcript, answering its last message.
  const prompt =
    turns.length === 1
      ? turns[0].content
      : `${turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n\nReply to the user's last message as the assistant.`;

  const args = [
    "-p",
    "--output-format",
    "json",
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
  ];

  mkdirSync(workDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: workDir, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const result = JSON.parse(stdout) as HeadlessResult;
        addUsage(result.usage);
        resolve(result);
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || `claude exited with ${code}`));
      }
    });
    child.stdin.end(prompt);
  });
}

export async function claudeCodeChatWithTool(
  model: string,
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
): Promise<ToolCall> {
  const result = await run(model, messages, tool.parameters, signal);
  if (result.is_error) throw new Error(`Claude Code: ${result.result ?? "the call failed"}`);
  if (typeof result.structured_output !== "object" || result.structured_output === null) {
    throw new Error("Claude Code didn't return the structured answer asked for");
  }
  return { name: tool.name, arguments: result.structured_output };
}

export async function claudeCodeChat(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const result = await run(model, messages, undefined, signal);
  if (result.is_error) throw new Error(`Claude Code: ${result.result ?? "the call failed"}`);
  const text = result.result?.trim();
  if (!text) throw new Error("Claude Code returned an empty reply");
  return text;
}
