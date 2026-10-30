import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { failed, noContent } from '$lib/api/http.server.js';
import { readAnalysis, resetAnalysis, startAnalysis } from '$lib/features/stats/analysis.server.js';

// Analysing reviewer performance: what's found so far, starting a run over
// what's new, and starting over.
export const GET: RequestHandler = () => json(readAnalysis());

export const POST: RequestHandler = () => {
	startAnalysis();
	return json(readAnalysis());
};

export const DELETE: RequestHandler = () => {
	try {
		resetAnalysis();
		return noContent();
	} catch (err) {
		return failed(err);
	}
};
