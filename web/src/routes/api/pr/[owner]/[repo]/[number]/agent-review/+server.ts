import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { dismissAgentReview, getAgentReview } from '$lib/features/panel/agentReviews.server.js';
import { badRequest, noContent, reviewerParam, validParams } from '$lib/api/http.server.js';

// A reviewer's review, which the panel starts: read, or let go of once it's over.
export const GET: RequestHandler = ({ params: { owner, repo, number }, url }) => {
	const reviewer = reviewerParam(url);
	if (!validParams(owner, repo, number) || !reviewer) return badRequest('invalid PR or reviewer');
	return json({ review: getAgentReview(owner, repo, number, reviewer) });
};

export const DELETE: RequestHandler = ({ params: { owner, repo, number }, url }) => {
	const reviewer = reviewerParam(url);
	if (!validParams(owner, repo, number) || !reviewer) return badRequest('invalid PR or reviewer');
	// `?force=1` when the reviewer entry itself is removed, stopping it if running.
	dismissAgentReview(owner, repo, number, reviewer, url.searchParams.get('force') === '1');
	return noContent();
};
