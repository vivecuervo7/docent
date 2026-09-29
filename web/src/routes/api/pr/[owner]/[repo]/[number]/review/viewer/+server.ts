import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchPrConversation } from '$lib/github/github.server.js';
import { badRequest, failed, validParams } from '$lib/server/http.js';
import { fetchViewer } from '$lib/features/posting/postReview.server.js';

// Who's reviewing: GitHub won't let you approve or request changes on your
// own PR.
export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		const [viewer, author] = await Promise.all([fetchViewer(), fetchPrConversation(owner, repo, number).then((c) => c.prAuthor)]);
		return json({ viewer, author });
	} catch (err) {
		return failed(err);
	}
};
