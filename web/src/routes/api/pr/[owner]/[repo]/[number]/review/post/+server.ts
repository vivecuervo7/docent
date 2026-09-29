import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, failed, validParams } from '$lib/server/http.js';
import { buildReviewPayload, postReviewPayload, type CommentToPost, type ReviewEvent } from '$lib/features/posting/postReview.server.js';

// With dryRun, returns exactly what would be sent without sending it. With
// pending, the review is left for the reviewer to submit on GitHub.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const body = await bodyOf(request);
	const event = body.event as ReviewEvent | undefined;
	const comments = body.comments as CommentToPost[] | undefined;
	if (!validParams(owner, repo, number) || (event !== 'COMMENT' && event !== 'APPROVE' && event !== 'REQUEST_CHANGES') || !Array.isArray(comments)) {
		return badRequest('invalid review');
	}
	try {
		const summary = typeof body.summary === 'string' ? body.summary : '';
		const payload = await buildReviewPayload(owner, repo, number, body.pending === true ? undefined : event, summary, comments);
		if (body.dryRun) return json({ payload });
		return json({ payload, ...(await postReviewPayload(owner, repo, number, payload)) });
	} catch (err) {
		return failed(err);
	}
};
