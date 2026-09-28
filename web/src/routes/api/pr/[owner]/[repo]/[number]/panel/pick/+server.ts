import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { badRequest, bodyOf, failed, reviewModel, validParams } from '$lib/server/http.js';
import { pickPersonas } from '$lib/server/pickPersonas.js';

// "Auto" on the panel: the personas this PR warrants, less those already on it.
export const POST: RequestHandler = async ({ params: { owner, repo, number }, request }) => {
	const body = await bodyOf(request);
	const exclude = body.exclude;
	if (!validParams(owner, repo, number) || !Array.isArray(exclude) || !exclude.every((id) => typeof id === 'string')) {
		return badRequest('invalid request');
	}
	try {
		return json({ picks: await pickPersonas(owner, repo, number, reviewModel(body), exclude) });
	} catch (err) {
		return failed(err);
	}
};
