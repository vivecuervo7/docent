import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { stopGeneration } from '$lib/server/generation.js';
import { badRequest, validParams } from '$lib/api/http.server.js';

export const POST: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	return json({ generation: stopGeneration(owner, repo, number) });
};
