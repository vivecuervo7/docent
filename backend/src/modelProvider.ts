// Thin provider abstraction over an OpenAI-compatible chat endpoint: a local
// one like oMLX, or a hosted proxy like LiteLLM. Kept generic (messages +
// tool schema in, tool calls out) so callers don't care which. Where it
// points is set in config.ts.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { claudeCodeAvailable, claudeCodeChat, claudeCodeChatWithTool, CLAUDE_CODE_MODELS } from "./claudeCode.js";
import { modelApiKey, modelBaseUrl, modelName } from "./config.js";

// A model picked from Claude Code's group is saved with this prefix; calls
// for it go through `claude -p` (claudeCode.ts) instead of the endpoint.
const CLAUDE_CODE_PREFIX = "claude-code:";

function claudeCodeModel(name: string): string | null {
  return name.startsWith(CLAUDE_CODE_PREFIX) ? name.slice(CLAUDE_CODE_PREFIX.length) : null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: unknown;
}

function headers(): Record<string, string> {
  const key = modelApiKey();
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

// node:http(s) rather than fetch: fetch gives up after five minutes without a
// response, and a large PR queued behind other work can legitimately take
// longer. There's no time limit here - a generation ends when it finishes or
// is stopped through `signal`.
function send(
  method: "GET" | "POST",
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const request = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method, headers: headers(), signal },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const postJson = (url: string, body: unknown, signal?: AbortSignal) => send("POST", url, body, signal);

export interface ModelOption {
  id: string;
  label: string;
  group: "endpoint" | "claude-code";
}

// Everything that can be picked: the endpoint's models, then Claude Code's
// when `claude` is installed. An unreachable endpoint still leaves Claude
// Code's, with the error to show.
export async function listModelOptions(): Promise<{ options: ModelOption[]; error?: string }> {
  const [endpoint, claude] = await Promise.all([
    listModels().then(
      (models) => ({ models, error: undefined }),
      (err: Error) => ({ models: [] as string[], error: err.message }),
    ),
    claudeCodeAvailable(),
  ]);
  const options: ModelOption[] = [
    ...endpoint.models.map((id) => ({ id, label: id, group: "endpoint" as const })),
    ...(claude
      ? CLAUDE_CODE_MODELS.map((alias) => ({ id: `${CLAUDE_CODE_PREFIX}${alias}`, label: alias, group: "claude-code" as const }))
      : []),
  ];
  return { options, error: endpoint.error };
}

// The models the endpoint offers, from its OpenAI-style model list.
async function listModels(): Promise<string[]> {
  const res = await send("GET", `${modelBaseUrl()}/models`, undefined);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`model backend returned ${res.status}`);
  }
  const data = JSON.parse(res.text) as { data?: { id?: unknown }[] };
  return (data.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : [])).sort();
}

// `model` picks a model for this call alone - a reviewer entry with its own
// choice - rather than the one picked on the start page.
export async function chatWithTool(
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
  model = modelName(),
): Promise<ToolCall> {
  const claude = claudeCodeModel(model);
  if (claude) return claudeCodeChatWithTool(claude, messages, tool, signal);

  const res = await postJson(
    `${modelBaseUrl()}/chat/completions`,
    {
      model,
      messages,
      tools: [{ type: "function", function: tool }],
      tool_choice: "required",
    },
    signal,
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`model backend returned ${res.status}`);
  }

  const data = JSON.parse(res.text) as {
    choices?: { message?: { tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };

  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) {
    throw new Error("model did not return a tool call");
  }

  return { name: call.function.name, arguments: JSON.parse(call.function.arguments) };
}

// For free-form replies, where a tool call adds nothing: the model answers
// in the message content.
export async function chat(messages: ChatMessage[], signal?: AbortSignal, model = modelName()): Promise<string> {
  const claude = claudeCodeModel(model);
  if (claude) return claudeCodeChat(claude, messages, signal);

  const res = await postJson(`${modelBaseUrl()}/chat/completions`, { model, messages }, signal);

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`model backend returned ${res.status}`);
  }

  const data = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("model returned an empty reply");
  }

  return content;
}
