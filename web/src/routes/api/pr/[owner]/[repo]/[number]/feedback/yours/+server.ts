import type { RequestHandler } from './$types';
import { draftYourFeedback, type ThreadForFeedback } from '$lib/server/feedback.js';
import { badRequest, bodyOf, heldOpen, reviewModel, validParams } from '$lib/api/http.server.js';

// Drafts review comments from the reviewer's threads. Held open like a note
// reply, in the same lane.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const body = await bodyOf(request);
	const threads = body.threads as ThreadForFeedback[] | undefined;
	if (!validParams(owner, repo, number) || !Array.isArray(threads) || threads.length === 0) return badRequest('invalid threads');
	const prTitle = typeof body.prTitle === 'string' ? body.prTitle : undefined;
	return heldOpen(async (signal) => ({ comments: await draftYourFeedback(threads, prTitle, signal, reviewModel(body)) }));
};
