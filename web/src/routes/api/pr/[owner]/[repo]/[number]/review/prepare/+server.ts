import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, reviewModel, validParams } from '$lib/api/http.server.js';
import { prepareReview, type Candidate, type ReviewerVerdict } from '$lib/features/posting/postReview.server.js';
import { startJob } from '$lib/storage/jobs.server.js';

// Prepares the review for posting, as a job on the round: answers at once,
// and what it made lands in the review. `input` is what the page needs to
// make it its own: which items it was prepared from.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const body = await bodyOf(request);
	const candidates = body.candidates as Candidate[] | undefined;
	if (!validParams(owner, repo, number) || !Array.isArray(candidates)) return badRequest('invalid candidates');
	const verdicts = (Array.isArray(body.verdicts) ? body.verdicts : []).filter(
		(v: unknown): v is ReviewerVerdict =>
			!!v && typeof (v as ReviewerVerdict).who === 'string' && ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes((v as ReviewerVerdict).event)
	);
	const round = Number.isInteger(body.round) ? (body.round as number) : undefined;
	startJob({ owner, repo, number, round }, 'prepare', body.input ?? null, async () =>
		candidates.length === 0
			? { comments: [], dropped: [], body: '', inBody: [], event: 'APPROVE', eventReason: 'Nothing kept to raise.' }
			: prepareReview(owner, repo, number, candidates, new AbortController().signal, reviewModel(body), verdicts)
	);
	return json({ started: true });
};
