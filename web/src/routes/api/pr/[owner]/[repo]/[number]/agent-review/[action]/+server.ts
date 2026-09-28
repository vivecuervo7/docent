import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { finishAgentReview, stopAgentReview } from '$lib/server/agentReview.js';
import { badRequest, reviewerParam, validParams } from '$lib/server/http.js';

export const POST: RequestHandler = ({ params: { owner, repo, number, action }, url }) => {
	const reviewer = reviewerParam(url);
	if (!validParams(owner, repo, number) || !reviewer || (action !== 'stop' && action !== 'finish')) {
		return badRequest('invalid PR, reviewer or action');
	}
	const review = action === 'stop' ? stopAgentReview(owner, repo, number, reviewer) : finishAgentReview(owner, repo, number, reviewer);
	return json({ review });
};
