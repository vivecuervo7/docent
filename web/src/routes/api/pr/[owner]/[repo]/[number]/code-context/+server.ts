import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getLookup } from '$lib/server/codeContext.js';
import { badRequest, validParams } from '$lib/api/http.server.js';

// The latest lookup of the code around the PR, for the panel to show.
export const GET: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	return json({ lookup: getLookup(owner, repo, number) });
};
