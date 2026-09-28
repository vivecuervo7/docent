import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, failed, validParams } from '$lib/server/http.js';
import { findReviewSince } from '$lib/server/postReview.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number }, url }) => {
	const since = Number(url.searchParams.get('since'));
	if (!validParams(owner, repo, number) || !Number.isFinite(since)) return badRequest('invalid PR or time');
	try {
		return json({ url: await findReviewSince(owner, repo, number, since) });
	} catch (err) {
		return failed(err);
	}
};
