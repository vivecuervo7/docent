import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { pinnedPrs, setPinned } from '$lib/storage/settings.server.js';
import { badRequest, bodyOf, validParams } from '$lib/api/http.server.js';

// PRs pinned to the top of the start page, whatever state they're in.
export const GET: RequestHandler = () => json({ pinned: pinnedPrs() });

export const PUT: RequestHandler = async ({ request }) => {
	const { owner, repo, number, pinned } = await bodyOf(request);
	if (!validParams(String(owner), String(repo), String(number)) || typeof pinned !== 'boolean') return badRequest('invalid PR');
	return json({ pinned: setPinned(`${owner}/${repo}/${number}`, pinned) });
};
