import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, failed, mcpUrl, reviewModel, validParams } from '$lib/api/http.server.js';
import { startChecks } from '$lib/features/threads/threadChecks.server.js';

// Checks whether GitHub threads have been dealt with, each saved for the PR
// as it's made, so the checks land whether or not the page is still open.
// Answers once they've started.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const body = await bodyOf(request);
	const ids = body.ids as unknown;
	const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && ids.every((id) => typeof id === 'string' && /^t\d{1,20}$/.test(id));
	if (!validParams(owner, repo, number) || !valid) return badRequest('invalid threads');
	try {
		return json({ started: await startChecks(owner, repo, number, ids as string[], reviewModel(body), mcpUrl(url)) });
	} catch (err) {
		return failed(err);
	}
};
