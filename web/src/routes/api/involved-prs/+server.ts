import type { RequestHandler } from './$types';
import { fetchInvolvedPrs } from '#lib/github/github.server.js';
import { failed } from '#lib/api/http.server.js';

// Open PRs the reviewer is part of, for the start page.
export const GET: RequestHandler = async () => {
	try {
		return Response.json({ prs: await fetchInvolvedPrs() });
	} catch (err) {
		return failed(err);
	}
};
