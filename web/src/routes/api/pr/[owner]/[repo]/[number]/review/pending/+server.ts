import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, failed, validParams } from '$lib/server/http.js';
import { findPendingReview } from '$lib/features/posting/postReview.server.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		return json({ url: await findPendingReview(owner, repo, number) });
	} catch (err) {
		return failed(err);
	}
};
