import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { setThreadsResolved } from '$lib/github/comments.server.js';
import { badRequest, bodyOf, failed, validParams } from '$lib/api/http.server.js';

// Resolves or reopens inline threads on GitHub: the ones a review marked,
// sent as it's posted or completed. Says which GitHub refused, and why.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const { changes } = await bodyOf(request);
	const valid =
		Array.isArray(changes) &&
		changes.length <= 200 &&
		changes.every((c) => c && typeof c.node === 'string' && /^[A-Za-z0-9_=-]{1,100}$/.test(c.node) && typeof c.resolved === 'boolean');
	if (!validParams(owner, repo, number) || !valid) return badRequest('invalid thread changes');
	try {
		return json({ results: await setThreadsResolved(changes) });
	} catch (err) {
		return failed(err);
	}
};
