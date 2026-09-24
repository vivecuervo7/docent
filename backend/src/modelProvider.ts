// Model calls, to wherever the model lives: an OpenAI-compatible provider
// (a local server like oMLX, or a hosted proxy like LiteLLM), Claude Code or
// Codex.
// Kept generic (messages + tool schema in, tool calls out) so callers don't
// care which. The providers are set on the Settings page (config.ts).

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { claudeCodeAvailable, claudeCodeChat, claudeCodeChatWithTool, CLAUDE_CODE_MODELS } from "./claudeCode.js";
import { codexAvailable, codexChat, codexChatWithTool, codexModels } from "./codex.js";
import { CLAUDE_CODE_PREFIX, CODEX_PREFIX, modelName, providers, resolveModel, type Provider } from "./config.js";

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

function headers(provider: Provider): Record<string, string> {
  return { "Content-Type": "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) };
}

// node:http(s) rather than fetch: fetch gives up after five minutes without a
// response, and a large PR queued behind other work can legitimately take
// longer. There's no time limit here - a generation ends when it finishes or
// is stopped through `signal`.
function send(
  provider: Provider,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const url = `${provider.baseUrl}${path}`;
  const request = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method, headers: headers(provider), signal },
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

const postJson = (provider: Provider, path: string, body: unknown, signal?: AbortSignal) => send(provider, "POST", path, body, signal);

export interface ModelOption {
  id: string;
  label: string;
  // Where it runs, as the menu groups it: "Claude Code" or a provider's name.
  source: string;
}

export interface ProviderStatus {
  models: string[];
  error?: string;
}

// A provider's models, from its OpenAI-style model list. Short on time, so a
// server that's off doesn't hold up the menu.
export async function listProviderModels(provider: Provider): Promise<ProviderStatus> {
  try {
    const res = await send(provider, "GET", "/models", undefined, AbortSignal.timeout(5000));
    if (res.status < 200 || res.status >= 300) return { models: [], error: `It answered ${res.status}.` };
    const data = JSON.parse(res.text) as { data?: { id?: unknown }[] };
    const models = (data.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : [])).sort();
    if (!models.length) return { models, error: "It answered, but listed no models. Does the address end in /v1?" };
    return { models };
  } catch (err) {
    const e = err as Error & { code?: string };
    return { models: [], error: e.name === "TimeoutError" ? "It didn't answer within 5 seconds." : e.code ? `Couldn't connect (${e.code}).` : e.message };
  }
}

// Codex's models when it's installed and signed in.
export async function codexStatus(): Promise<{ installed: boolean; models: string[] }> {
  const installed = await codexAvailable();
  return { installed, models: installed ? await codexModels() : [] };
}

// Everything that can be picked right now: Claude Code's models when
// `claude` is installed, Codex's when it's signed in, then each provider's
// that answers.
export async function listModelOptions(): Promise<ModelOption[]> {
  const list = providers();
  const [claude, codex, statuses] = await Promise.all([claudeCodeAvailable(), codexStatus(), Promise.all(list.map(listProviderModels))]);
  return [
    ...(claude ? CLAUDE_CODE_MODELS.map((alias) => ({ id: `${CLAUDE_CODE_PREFIX}${alias}`, label: alias, source: "Claude Code" })) : []),
    ...codex.models.map((model) => ({ id: `${CODEX_PREFIX}${model}`, label: model, source: "Codex" })),
    ...list.flatMap((provider, i) => statuses[i].models.map((model) => ({ id: `${provider.id}:${model}`, label: model, source: provider.name }))),
  ];
}

function target(model: string) {
  const resolved = resolveModel(model);
  if (!resolved) throw new Error("No model is set up. Add a provider on the Settings page, or install Claude Code or Codex.");
  return resolved;
}

// `model` picks a model for this call alone - a reviewer entry with its own
// choice - rather than the one picked on the start page.
export async function chatWithTool(
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
  model = modelName(),
): Promise<ToolCall> {
  const resolved = target(model);
  if (resolved.kind === "claude-code") return claudeCodeChatWithTool(resolved.alias, messages, tool, signal);
  if (resolved.kind === "codex") return codexChatWithTool(resolved.model, messages, tool, signal);

  const res = await postJson(
    resolved.provider,
    "/chat/completions",
    {
      model: resolved.model,
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
  const resolved = target(model);
  if (resolved.kind === "claude-code") return claudeCodeChat(resolved.alias, messages, signal);
  if (resolved.kind === "codex") return codexChat(resolved.model, messages, signal);

  const res = await postJson(resolved.provider, "/chat/completions", { model: resolved.model, messages }, signal);

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
