import { createMCPClient } from '@ai-sdk/mcp';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, hasToolCall, jsonSchema, stepCountIs, tool, type JSONSchema7, type ToolSet } from 'ai';
import { lookStep } from './claudeCode.server.js';
import type { ChatMessage, CodeAccess, ToolCall, ToolDefinition } from './modelProvider.server.js';
import { providerKey } from './providerKey.server.js';
import type { Provider } from '../storage/settings.server.js';

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

// What one look may send back. Docent reads a file up to 400,000 bytes, and
// every result is sent again with each later step, so one read of a lockfile
// could use a model's whole token allowance by itself.
const MAX_RESULT = 20_000;

type Part = { type?: string; text?: string };

function clipped(result: unknown): unknown {
	const content = (result as { content?: Part[] } | null)?.content;
	if (!Array.isArray(content)) return result;
	return {
		...(result as object),
		content: content.map((part) =>
			part.type === 'text' && typeof part.text === 'string' && part.text.length > MAX_RESULT
				? {
						...part,
						text: `${part.text.slice(0, MAX_RESULT)}\n\n[Cut at ${MAX_RESULT.toLocaleString()} of ${part.text.length.toLocaleString()} characters. Ask for less to see the rest: a line range for read_file, a path for get_diff, a narrower pattern for search_code.]`
					}
				: part
		)
	};
}

// The model, and Docent's read tools over MCP, each result clipped. Close
// `client` when the call's done.
async function open(provider: Provider, model: string, access: CodeAccess) {
	const apiKey = await providerKey(provider);
	const llm = createOpenAICompatible({ name: provider.id, baseURL: provider.baseUrl, apiKey }).chatModel(model);
	const client = await createMCPClient({ transport: { type: 'http', url: access.mcpUrl } });
	try {
		const looks: ToolSet = Object.fromEntries(
			Object.entries(await client.tools())
				.filter(([name]) => access.tools.includes(name))
				.map(([name, look]) => {
					const run = look.execute as (input: unknown, options: unknown) => Promise<unknown>;
					return [name, { ...look, execute: async (input: unknown, options: unknown) => clipped(await run(input, options)) }];
				})
		);
		return { llm, client, looks };
	} catch (err) {
		await client.close();
		throw err;
	}
}

const systemOf = (messages: ChatMessage[]) =>
	messages
		.filter((m) => m.role === 'system')
		.map((m) => m.content)
		.join('\n\n');
const turnsOf = (messages: ChatMessage[]) =>
	messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

export async function providerToolLoop(
	provider: Provider,
	model: string,
	messages: ChatMessage[],
	report: ToolDefinition,
	access: CodeAccess,
	signal?: AbortSignal
): Promise<ToolCall> {
	const { llm, client, looks } = await open(provider, model, access);
	try {
		const tools: ToolSet = { ...looks, [report.name]: tool({ description: report.description, inputSchema: jsonSchema(report.parameters as JSONSchema7) }) };
		const result = await generateText({
			model: llm,
			system: systemOf(messages),
			messages: turnsOf(messages),
			tools,
			toolChoice: 'required',
			stopWhen: [hasToolCall(report.name), stepCountIs(MAX_STEPS)],
			prepareStep: ({ stepNumber }) =>
				stepNumber === MAX_STEPS - 1 ? { toolChoice: { type: 'tool', toolName: report.name }, activeTools: [report.name] } : {},
			maxRetries: MAX_RETRIES,
			abortSignal: signal,
			onStepFinish: ({ toolCalls }) => {
				for (const call of toolCalls)
					if (call.toolName !== report.name) access.onStep?.(lookStep(call.toolName, (call.input ?? {}) as Record<string, unknown>));
			}
		});
		const reported = result.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === report.name);
		if (!reported) throw new Error('model did not return a tool call');
		return { name: report.name, arguments: reported.input };
	} finally {
		await client.close();
	}
}

// The same loop for an answer in words, such as a reply to a question: the
// model looks as far as it needs to and then answers. It ends when a step
// asks for no more looks, and the last step is held to answering with what
// it has.
export async function providerChatLoop(provider: Provider, model: string, messages: ChatMessage[], access: CodeAccess, signal?: AbortSignal): Promise<string> {
	const { llm, client, looks } = await open(provider, model, access);
	try {
		const result = await generateText({
			model: llm,
			system: systemOf(messages),
			messages: turnsOf(messages),
			tools: looks,
			stopWhen: stepCountIs(MAX_STEPS),
			prepareStep: ({ stepNumber }) => (stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' } : {}),
			maxRetries: MAX_RETRIES,
			abortSignal: signal,
			onStepFinish: ({ toolCalls }) => {
				for (const call of toolCalls) access.onStep?.(lookStep(call.toolName, (call.input ?? {}) as Record<string, unknown>));
			}
		});
		const text = result.text.trim();
		if (!text) throw new Error('model returned an empty reply');
		return text;
	} finally {
		await client.close();
	}
}
