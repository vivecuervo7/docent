import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchInvolvedPrs } from '$lib/server/github.js';
import { failed } from '$lib/server/http.js';

// Open PRs the reviewer is part of, for the start page.
export const GET: RequestHandler = async () => {
	try {
		return json({ prs: await fetchInvolvedPrs() });
	} catch (err) {
		return failed(err);
	}
};
