// Thin provider abstraction over an OpenAI-compatible chat endpoint: a local
// one like oMLX, or a hosted proxy like LiteLLM. Kept generic (messages +
// tool schema in, tool calls out) so callers don't care which. Where it
// points is set in config.ts.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { modelApiKey, modelBaseUrl, modelName } from "./config.js";

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

// The models the endpoint offers, from its OpenAI-style model list.
export async function listModels(): Promise<string[]> {
  const res = await send("GET", `${modelBaseUrl()}/models`, undefined);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`model backend returned ${res.status}`);
  }
  const data = JSON.parse(res.text) as { data?: { id?: unknown }[] };
  return (data.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : [])).sort();
}

export async function chatWithTool(
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
): Promise<ToolCall> {
  const res = await postJson(
    `${modelBaseUrl()}/chat/completions`,
    {
      model: modelName(),
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
export async function chat(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const res = await postJson(`${modelBaseUrl()}/chat/completions`, { model: modelName(), messages }, signal);

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
