import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { hiddenPrs, setHidden } from '$lib/storage/settings.server.js';
import { badRequest, bodyOf, validParams } from '$lib/api/http.server.js';
import { keyFor } from '$lib/storage/store.server.js';

// PRs hidden from the start page's lists: old ones that can't be closed.
export const GET: RequestHandler = () => json({ hidden: hiddenPrs() });

export const PUT: RequestHandler = async ({ request }) => {
	const { owner, repo, number, hidden } = await bodyOf(request);
	if (!validParams(String(owner), String(repo), String(number)) || typeof hidden !== 'boolean') return badRequest('invalid PR');
	return json({ hidden: setHidden(keyFor(String(owner), String(repo), String(number)), hidden) });
};
