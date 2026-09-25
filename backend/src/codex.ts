import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChatMessage, ToolCall, ToolDefinition } from "./modelProvider.js";

const execFileAsync = promisify(execFile);

// Model calls through Codex's headless mode (`codex exec`), on the
// reviewer's own Codex login. Each call is prompt in, answer out:
// - its shell, browser, computer use, apps, plugins, sub-agents, image
//   generation and web search are switched off, so it can only answer;
// - a read-only sandbox in an empty folder, without the reviewer's Codex
//   config or rules, and no session saved.

const workDir = join(tmpdir(), "docent-codex");

const OFF = ["shell_tool", "apps", "browser_use", "computer_use", "in_app_browser", "image_generation", "multi_agent", "plugins", "goals"];

let available: Promise<boolean> | null = null;

// Whether `codex` is installed and signed in, checked once.
export function codexAvailable(): Promise<boolean> {
  available ??= execFileAsync("codex", ["login", "status"], { timeout: 10_000 }).then(
    ({ stdout, stderr }) => /logged in/i.test(`${stdout}${stderr}`),
    () => false,
  );
  return available;
}

let catalog: Promise<string[]> | null = null;

// The models Codex offers for picking, from its own catalog, checked once.
// A model can be listed and still be outside the reviewer's plan; a call to
// it then says so.
export function codexModels(): Promise<string[]> {
  catalog ??= execFileAsync("codex", ["debug", "models"], { timeout: 10_000, cwd: tmpdir(), maxBuffer: 16 * 1024 * 1024 }).then(
    ({ stdout }) => {
      const { models } = JSON.parse(stdout) as { models?: { slug?: string; visibility?: string; priority?: number }[] };
      return (models ?? [])
        .filter((m) => m.slug && m.visibility === "list")
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        .map((m) => m.slug!);
    },
    () => [],
  );
  return catalog;
}

// Codex holds its answer to the schema strictly: every object closed, every
// property required. What was optional may be null instead.
type Schema = Record<string, unknown>;

function strict(schema: Schema): Schema {
  const out: Schema = { ...schema };
  if (schema.type === "object" && schema.properties) {
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const properties = schema.properties as Record<string, Schema>;
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, required.has(key) ? strict(value) : nullable(strict(value))]),
    );
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  if (schema.items) out.items = strict(schema.items as Schema);
  return out;
}

function nullable(schema: Schema): Schema {
  if (!schema.type) return { anyOf: [schema, { type: "null" }] };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return { ...schema, type: [...types, "null"], ...(schema.enum ? { enum: [...(schema.enum as unknown[]), null] } : {}) };
}

// The nulls standing in for optional fields, taken back out.
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, withoutNulls(v)]));
  }
  return value;
}

function prompt(messages: ChatMessage[]): string {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system");
  // A single request goes in as it is; a conversation (a thread with
  // follow-ups) goes in as a transcript, answering its last message.
  const request =
    turns.length === 1
      ? turns[0].content
      : `${turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n\nReply to the user's last message as the assistant.`;
  return system ? `${system}\n\n---\n\n${request}` : request;
}

// The last line Codex printed that says what went wrong.
function failure(stderr: string, code: number | null): Error {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const missing = lines.find((l) => /does not exist or you do not have access/i.test(l));
  if (missing) return new Error("Codex: that model isn't available on your plan.");
  const error = [...lines].reverse().find((l) => /error/i.test(l) && !/reconnecting/i.test(l));
  return new Error(`Codex: ${error ?? `exited with ${code}`}`);
}

// Docent's MCP server, for an external reviewer's session: its read tools
// only, approved ahead, since nobody is there to approve them.
export interface CodexMcp {
  url: string;
  tools: string[];
}

function run(
  model: string | undefined,
  messages: ChatMessage[],
  schema: Schema | undefined,
  signal?: AbortSignal,
  mcp?: CodexMcp,
): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "docent-codex-call-"));
  const lastMessage = join(dir, "last.txt");
  const schemaFile = join(dir, "schema.json");
  if (schema) writeFileSync(schemaFile, JSON.stringify(strict(schema)));

  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "-C",
    workDir,
    ...(model ? ["-m", model] : []),
    ...OFF.flatMap((feature) => ["--disable", feature]),
    "-c",
    "web_search=disabled",
    ...(mcp
      ? [
          "-c",
          `mcp_servers.docent.url=${JSON.stringify(mcp.url)}`,
          "-c",
          'mcp_servers.docent.default_tools_approval_mode="approve"',
          "-c",
          `mcp_servers.docent.enabled_tools=${JSON.stringify(mcp.tools)}`,
        ]
      : []),
    ...(schema ? ["--output-schema", schemaFile] : []),
    "-o",
    lastMessage,
    "--color",
    "never",
    "-",
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn("codex", args, { cwd: workDir, signal });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      let text = "";
      try {
        text = readFileSync(lastMessage, "utf8").trim();
      } catch {
        // No answer written; the error says why.
      }
      if (code === 0 && text) resolve(text);
      else reject(failure(stderr, code));
    });
    child.stdin.end(prompt(messages));
  }).finally(() => rmSync(dir, { recursive: true, force: true }));
}

export async function codexChatWithTool(
  model: string,
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
): Promise<ToolCall> {
  const text = await run(model, messages, tool.parameters, signal);
  try {
    return { name: tool.name, arguments: withoutNulls(JSON.parse(text)) };
  } catch {
    throw new Error("Codex didn't return the structured answer asked for");
  }
}

export async function codexChat(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  return run(model, messages, undefined, signal);
}

// An external reviewer's session on Codex: its prompt in, the findings out
// in the given shape, reading the PR through Docent's MCP server.
export async function codexSession(
  model: string | undefined,
  prompt: string,
  schema: Schema,
  mcp: CodexMcp,
  signal?: AbortSignal,
): Promise<unknown> {
  const text = await run(model, [{ role: "user", content: prompt }], schema, signal, mcp);
  return withoutNulls(JSON.parse(text));
}
