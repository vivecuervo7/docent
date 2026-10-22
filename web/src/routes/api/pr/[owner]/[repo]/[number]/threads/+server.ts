import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, failed, validParams } from '$lib/api/http.server.js';
import { checksOf, prThreads } from '$lib/features/threads/threadChecks.server.js';
import { keyFor } from '$lib/storage/store.server.js';

// Every GitHub thread on the PR, with what checking them found: needs no
// review of it. `?checks` reads just the checks, while some are under way.
export const GET: RequestHandler = async ({ params: { owner, repo, number }, url }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	if (url.searchParams.has('checks')) return json({ checks: checksOf(keyFor(owner, repo, number)) });
	try {
		return json(await prThreads(owner, repo, number));
	} catch (err) {
		return failed(err);
	}
};
