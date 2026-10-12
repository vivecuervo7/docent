import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchPrMeta } from '$lib/github/github.server.js';
import { badRequest, failed, validParams } from '$lib/api/http.server.js';
import { fetchReviewFiles } from '$lib/github/range.server.js';

// With `round`, an earlier round's files.
export const GET: RequestHandler = async ({ params: { owner, repo, number }, url }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		const [files, meta] = await Promise.all([fetchReviewFiles(owner, repo, number, url.searchParams.has('round') ? Number(url.searchParams.get('round')) : undefined), fetchPrMeta(owner, repo, number)]);
		return json({ files, meta });
	} catch (err) {
		return failed(err);
	}
};
