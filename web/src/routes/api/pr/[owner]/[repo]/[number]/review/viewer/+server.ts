import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { pull } from '#lib/github/gh.server.js';
import { badRequest, failed, validParams } from '#lib/api/http.server.js';
import { fetchViewer } from '#lib/features/posting/postReview.server.js';

// Who's reviewing: GitHub won't let you approve or request changes on your
// own PR. And whether auto-merge is on, which approving can set off.
export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		const [viewer, { author, autoMerge }] = await Promise.all([fetchViewer(), pull(owner, repo, number)]);
		return json({ viewer, author, autoMerge });
	} catch (err) {
		return failed(err);
	}
};
