import type { RequestHandler } from './$types';
import { badRequest, failed, validParams } from '#lib/api/http.server.js';
import { findReviewSince } from '#lib/features/posting/postReview.server.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number }, url }) => {
	const since = Number(url.searchParams.get('since'));
	if (!validParams(owner, repo, number) || !Number.isFinite(since)) return badRequest('invalid PR or time');
	try {
		return Response.json({ url: await findReviewSince(owner, repo, number, since) });
	} catch (err) {
		return failed(err);
	}
};
