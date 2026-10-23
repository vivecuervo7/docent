import { createMCPClient } from "@ai-sdk/mcp";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, hasToolCall, jsonSchema, stepCountIs, tool, type JSONSchema7, type ToolSet } from "ai";
import { lookStep } from "./claudeCode.server.js";
import type { ChatMessage, CodeAccess, ToolCall, ToolDefinition } from "./modelProvider.server.js";
import { providerKey } from "./providerKey.server.js";
import type { Provider } from "../storage/settings.server.js";

// A model on an OpenAI-compatible provider, with Docent's read tools to look
// through the code before it reports - what Claude Code and Codex already get
// from their own sessions. The provider only sees ordinary tool calls; Docent
// makes the looks, over its own MCP server.

// Looks and the report together. The last step is held to the report, so a
// model that keeps looking still hands back what it has.
const MAX_STEPS = 24;

// Each model call is retried this many times, backing off from two seconds and
// following the provider's retry-after. The default of two retries waits about
// six seconds in all, which can't outlast a rate limit's window, and a
// reviewer that fails loses every look it has made.
const MAX_RETRIES = 6;

export async function providerToolLoop(
  provider: Provider,
  model: string,
  messages: ChatMessage[],
  report: ToolDefinition,
  access: CodeAccess,
  signal?: AbortSignal,
): Promise<ToolCall> {
  const apiKey = await providerKey(provider);
  const llm = createOpenAICompatible({ name: provider.id, baseURL: provider.baseUrl, apiKey }).chatModel(model);
  const client = await createMCPClient({ transport: { type: "http", url: access.mcpUrl } });
  try {
    const looks = Object.fromEntries(Object.entries(await client.tools()).filter(([name]) => access.tools.includes(name)));
    const tools: ToolSet = { ...looks, [report.name]: tool({ description: report.description, inputSchema: jsonSchema(report.parameters as JSONSchema7) }) };
    const result = await generateText({
      model: llm,
      system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      tools,
      toolChoice: "required",
      stopWhen: [hasToolCall(report.name), stepCountIs(MAX_STEPS)],
      prepareStep: ({ stepNumber }) => (stepNumber === MAX_STEPS - 1 ? { toolChoice: { type: "tool", toolName: report.name }, activeTools: [report.name] } : {}),
      maxRetries: MAX_RETRIES,
      abortSignal: signal,
      onStepFinish: ({ toolCalls }) => {
        for (const call of toolCalls) if (call.toolName !== report.name) access.onStep?.(lookStep(call.toolName, (call.input ?? {}) as Record<string, unknown>));
      },
    });
    const reported = result.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === report.name);
    if (!reported) throw new Error("model did not return a tool call");
    return { name: report.name, arguments: reported.input };
  } finally {
    await client.close();
  }
}
