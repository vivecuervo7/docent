import type { RequestHandler } from './$types';
import { badRequest, failed, validParams } from '#lib/api/http.server.js';
import { findPendingReview } from '#lib/features/posting/postReview.server.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		return Response.json({ url: await findPendingReview(owner, repo, number) });
	} catch (err) {
		return failed(err);
	}
};
