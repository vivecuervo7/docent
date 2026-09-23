// Thin provider abstraction over a local, OpenAI-compatible chat endpoint
// (oMLX). Kept generic (messages + tool schema in, tool calls out) so a
// different local backend could be swapped in without touching callers.

import { request } from "node:http";

const OMLX_BASE_URL = "http://127.0.0.1:8000/v1";
const MODEL = "gemma-4-12B-it-8bit";

// How many PRs may generate at once; the rest wait in a queue. A local model
// serves one request at a time, so running more only makes each one slower.
export const MAX_CONCURRENT_GENERATIONS = 1;

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

// node:http rather than fetch: fetch gives up after five minutes without a
// response, and a large PR queued behind other work can legitimately take
// longer. There's no time limit here - a generation ends when it finishes or
// is stopped through `signal`.
function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, signal },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

export async function chatWithTool(
  messages: ChatMessage[],
  tool: ToolDefinition,
  signal?: AbortSignal,
): Promise<ToolCall> {
  const res = await postJson(
    `${OMLX_BASE_URL}/chat/completions`,
    {
      model: MODEL,
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
  const res = await postJson(`${OMLX_BASE_URL}/chat/completions`, { model: MODEL, messages }, signal);

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
