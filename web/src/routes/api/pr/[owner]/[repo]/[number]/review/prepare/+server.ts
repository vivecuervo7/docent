import type { RequestHandler } from './$types';
import { badRequest, bodyOf, heldOpen, reviewModel, validParams } from '$lib/server/http.js';
import { prepareReview, type Candidate, type ReviewerVerdict } from '$lib/features/posting/postReview.server.js';

export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const body = await bodyOf(request);
	const candidates = body.candidates as Candidate[] | undefined;
	if (!validParams(owner, repo, number) || !Array.isArray(candidates)) return badRequest('invalid candidates');
	const verdicts = (Array.isArray(body.verdicts) ? body.verdicts : []).filter(
		(v: unknown): v is ReviewerVerdict =>
			!!v && typeof (v as ReviewerVerdict).who === 'string' && ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes((v as ReviewerVerdict).event)
	);
	return heldOpen(async (signal) =>
		candidates.length === 0
			? { comments: [], dropped: [], body: '', inBody: [], event: 'APPROVE', eventReason: 'Nothing kept to raise.' }
			: prepareReview(owner, repo, number, candidates, signal, reviewModel(body), verdicts)
	);
};
