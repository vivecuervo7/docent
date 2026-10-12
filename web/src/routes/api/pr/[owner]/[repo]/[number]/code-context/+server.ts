import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getLookup } from '$lib/features/panel/codeContext.server.js';
import { badRequest, validParams } from '$lib/api/http.server.js';

// The latest lookup of the code around the PR, for the panel to show; with
// `round`, an earlier round's.
export const GET: RequestHandler = ({ params: { owner, repo, number }, url }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	const round = url.searchParams.has('round') ? Number(url.searchParams.get('round')) : undefined;
	return json({ lookup: getLookup(owner, repo, number, Number.isInteger(round) ? round : undefined) });
};
