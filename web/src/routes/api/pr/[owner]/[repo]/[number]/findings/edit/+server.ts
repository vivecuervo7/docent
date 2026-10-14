import type { RequestHandler } from './$types';
import { editRound } from '$lib/features/panel/editorRuns.server.js';
import { badRequest, bodyOf, mcpUrl, noContent, validParams } from '$lib/api/http.server.js';

// Has the panel's editor go through a round's findings that are ready for
// it. It runs as reviews save anyway; this catches up on any left over, as
// from a run the backend restarted under. Answers at once: the editor saves
// what it makes into the review.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request, url }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid PR');
	const { round } = await bodyOf(request);
	void editRound(owner, repo, number, Number.isInteger(round) ? round : undefined, mcpUrl(url));
	return noContent();
};
