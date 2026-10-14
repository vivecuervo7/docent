import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { draftYourFeedback, type ThreadForFeedback } from '$lib/features/wrap-up/draftComments.server.js';
import { badRequest, bodyOf, reviewModel, validParams } from '$lib/api/http.server.js';
import { startJob } from '$lib/storage/jobs.server.js';

// Drafts review comments from the reviewer's threads, as a job on the round:
// answers at once, and the draft lands in the review when it's made.
// `input` is what the page needs to make the draft its own: which threads.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const body = await bodyOf(request);
	const threads = body.threads as ThreadForFeedback[] | undefined;
	if (!validParams(owner, repo, number) || !Array.isArray(threads) || threads.length === 0) return badRequest('invalid threads');
	const prTitle = typeof body.prTitle === 'string' ? body.prTitle : undefined;
	const round = Number.isInteger(body.round) ? (body.round as number) : undefined;
	startJob({ owner, repo, number, round }, 'draft', body.input ?? null, () =>
		draftYourFeedback(threads, prTitle, new AbortController().signal, reviewModel(body)).then((comments) => ({ comments }))
	);
	return json({ started: true });
};
