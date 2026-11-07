import type { RequestHandler } from './$types';
import { fetchGitHubComments } from '#lib/github/comments.server.js';
import { badRequest, failed, validParams } from '#lib/api/http.server.js';

export const GET: RequestHandler = async ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	try {
		return Response.json(await fetchGitHubComments(owner, repo, number));
	} catch (err) {
		return failed(err);
	}
};
