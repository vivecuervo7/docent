import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { claudeCodeAvailable, CLAUDE_CODE_MODELS } from '$lib/models/claudeCode.server.js';
import { addProvider, providers, runnerConcurrency, settingsFile, type Provider } from '$lib/storage/settings.server.js';
import { homedir } from 'node:os';
import { providerFields, publicProvider } from '$lib/features/settings/fields.server.js';
import { bodyOf, forbidden, fromThisApp } from '$lib/api/http.server.js';
import { codexStatus, listProviderModels } from '$lib/models/modelProvider.server.js';
import { lastKnown } from '$lib/storage/lastKnown.server.js';

// The Settings page: Claude Code, Codex, and the OpenAI-compatible providers
// with whether each answers: as last looked at, unless `?fresh` asks for a
// look now. Codex is looked at afresh then, so signing in or out shows on
// "Check again".
const status = lastKnown('providers', async () => {
	const list = providers();
	const [claude, codex, statuses] = await Promise.all([claudeCodeAvailable(), codexStatus(true), Promise.all(list.map(listProviderModels))]);
	return {
		claudeCode: { installed: claude, models: claude ? CLAUDE_CODE_MODELS : [], concurrency: runnerConcurrency('claude-code') },
		codex: { ...codex, concurrency: runnerConcurrency('codex') },
		providers: list.map((p, i) => ({ ...publicProvider(p), ...statuses[i] })),
		settingsFile: settingsFile.startsWith(homedir()) ? `~${settingsFile.slice(homedir().length)}` : settingsFile
	};
});

export const GET: RequestHandler = async ({ url }) => json(await (url.searchParams.has('fresh') ? status.fresh() : status.get()));

export const POST: RequestHandler = async ({ request, url }) => {
	const body = await bodyOf(request);
	if (typeof body.apiKeyCommand === 'string' && body.apiKeyCommand.trim() && !fromThisApp(request, url)) return forbidden('A key command can only be saved from Docent on this machine.');
	const checked = providerFields(body, false);
	if ('error' in checked) return json(checked, { status: 400 });
	return json({ provider: publicProvider(addProvider(checked.fields as Omit<Provider, 'id'>)) });
};
