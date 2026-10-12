import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchPrCommits } from '$lib/github/range.server.js';
import { badRequest, failed, validParams } from '$lib/api/http.server.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		return json({ commits: await fetchPrCommits(owner, repo, number) });
	} catch (err) {
		return failed(err);
	}
};
