import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { runnerConcurrency, setRunnerConcurrency } from '$lib/storage/settings.server.js';
import { badRequest, bodyOf } from '$lib/api/http.server.js';

// How many calls Claude Code or Codex runs at once.
export const PUT: RequestHandler = async ({ params: { runner }, request }) => {
	const n = (await bodyOf(request)).concurrency;
	if ((runner !== 'claude-code' && runner !== 'codex') || !Number.isInteger(n) || n < 1 || n > 32) return badRequest('Choose from 1 to 32.');
	setRunnerConcurrency(runner, n);
	return json({ concurrency: runnerConcurrency(runner) });
};
