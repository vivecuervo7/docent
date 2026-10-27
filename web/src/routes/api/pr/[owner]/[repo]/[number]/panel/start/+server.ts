import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { startReviewer } from '$lib/features/panel/panelRuns.server.js';
import type { ReviewerSetup } from '$lib/features/panel/setup.js';
import { badRequest, bodyOf, failed, mcpUrl, reviewerParam, validParams } from '$lib/api/http.server.js';

// Starts one of a round's reviewers. Its review, and "auto" choosing its
// personas, go on here and save into the review; this answers once it's begun.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	const body = await bodyOf(request);
	const reviewer = reviewerParam(url);
	const setup = body.setup as ReviewerSetup | undefined;
	const round = Number.isInteger(body.round) ? (body.round as number) : undefined;
	const valid =
		setup &&
		((setup.mode === 'builtin' && typeof setup.model === 'string' && setup.model.length <= 200) ||
			(setup.mode === 'session' && typeof setup.session === 'string') ||
			setup.mode === 'external');
	if (!validParams(owner, repo, number) || !reviewer || !valid) return badRequest('invalid reviewer or setup');
	try {
		await startReviewer({ owner, repo, number, round }, reviewer, setup, mcpUrl(url));
		return json({ started: true });
	} catch (err) {
		return failed(err);
	}
};
