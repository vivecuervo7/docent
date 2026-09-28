import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { claudeCodeAvailable, CLAUDE_CODE_MODELS } from '$lib/server/claudeCode.js';
import { addProvider, providers, runnerConcurrency, type Provider } from '$lib/server/config.js';
import { providerFields, publicProvider } from '$lib/server/fields.js';
import { bodyOf } from '$lib/server/http.js';
import { codexStatus, listProviderModels } from '$lib/server/modelProvider.js';

// The Settings page: Claude Code, Codex, and the OpenAI-compatible providers
// with whether each answers.
export const GET: RequestHandler = async () => {
	const list = providers();
	const [claude, codex, statuses] = await Promise.all([claudeCodeAvailable(), codexStatus(), Promise.all(list.map(listProviderModels))]);
	return json({
		claudeCode: { installed: claude, models: claude ? CLAUDE_CODE_MODELS : [], concurrency: runnerConcurrency('claude-code') },
		codex: { ...codex, concurrency: runnerConcurrency('codex') },
		providers: list.map((p, i) => ({ ...publicProvider(p), ...statuses[i] }))
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const checked = providerFields(await bodyOf(request), false);
	if ('error' in checked) return json(checked, { status: 400 });
	return json({ provider: publicProvider(addProvider(checked.fields as Omit<Provider, 'id'>)) });
};
