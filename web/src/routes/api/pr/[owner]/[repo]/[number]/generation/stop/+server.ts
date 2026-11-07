import type { RequestHandler } from './$types';
import { stopGeneration } from '#lib/features/preparing/generation.server.js';
import { badRequest, validParams } from '#lib/api/http.server.js';

export const POST: RequestHandler = ({ params: { owner, repo, number } }) => {
	if (!validParams(owner, repo, number)) return badRequest('invalid owner, repo, or PR number');
	return Response.json({ generation: stopGeneration(owner, repo, number) });
};
