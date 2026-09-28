import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchPrStatuses } from '$lib/server/github.js';
import { badRequest, bodyOf, failed, validParams } from '$lib/server/http.js';

// Where saved PRs stand on GitHub now, for the start page.
export const POST: RequestHandler = async ({ request }) => {
	const prs = (await bodyOf(request)).prs;
	if (!Array.isArray(prs) || prs.length > 200 || !prs.every((p) => p && validParams(String(p.owner), String(p.repo), String(p.number)))) {
		return badRequest('invalid PRs');
	}
	try {
		const statuses = await fetchPrStatuses(prs.map((p: Record<string, unknown>) => ({ owner: String(p.owner), repo: String(p.repo), number: String(p.number) })));
		return json({ statuses });
	} catch (err) {
		return failed(err);
	}
};
