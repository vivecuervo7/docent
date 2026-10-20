import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { changeThreads } from '$lib/github/comments.server.js';
import { tally } from '$lib/features/stats/tallies.server.js';
import { badRequest, bodyOf, failed, validParams } from '$lib/api/http.server.js';

// Replies to, resolves or reopens inline threads on GitHub, as the reviewer
// does it. Says which GitHub refused, and why.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const { changes } = await bodyOf(request);
	const valid =
		Array.isArray(changes) &&
		changes.length <= 200 &&
		changes.every(
			(c) =>
				c &&
				typeof c.node === 'string' &&
				/^[A-Za-z0-9_=-]{1,100}$/.test(c.node) &&
				(c.resolved === undefined || typeof c.resolved === 'boolean') &&
				(c.reply === undefined || (Number.isInteger(c.reply.comment) && typeof c.reply.body === 'string' && !!c.reply.body.trim() && c.reply.body.length <= 65_000)) &&
				(c.resolved !== undefined || c.reply !== undefined)
		);
	if (!validParams(owner, repo, number) || !valid) return badRequest('invalid thread changes');
	try {
		const results = await changeThreads({ owner, repo, number }, changes);
		for (const r of results) if (!r.error && changes.find((c: { node: string }) => c.node === r.node)?.resolved === true) tally('resolved');
		return json({ results });
	} catch (err) {
		return failed(err);
	}
};
