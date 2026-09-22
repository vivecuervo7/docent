// Thin provider abstraction over a local, OpenAI-compatible chat endpoint
// (oMLX). Kept generic (messages + tool schema in, tool calls out) so a
// different local backend could be swapped in without touching callers.

const OMLX_BASE_URL = "http://127.0.0.1:8000/v1";
const MODEL = "gemma-4-12B-it-8bit";

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

export async function chatWithTool(
  messages: ChatMessage[],
  tool: ToolDefinition,
): Promise<ToolCall> {
  const res = await fetch(`${OMLX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: [{ type: "function", function: tool }],
      tool_choice: "required",
    }),
  });

  if (!res.ok) {
    throw new Error(`model backend returned ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };

  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) {
    throw new Error("model did not return a tool call");
  }

  return { name: call.function.name, arguments: JSON.parse(call.function.arguments) };
}
