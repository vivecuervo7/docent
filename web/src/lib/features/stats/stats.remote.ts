import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { readStats } from './stats.server.js';
import * as analysis from './analysis.server.js';

// What reviewing has come to, for the Stats page.
export const getStats = query(async () => readStats());

// How the panel performs, as it changes: a run's progress while it goes,
// then what it found. The page stays connected while it shows it; when it
// goes, the request's signal ends the wait.
export const getAnalysis = query.live(async function* () {
	const { signal } = getRequestEvent().request;
	while (!signal.aborted) {
		// Listening before reading, so a change made while this value is on
		// its way isn't missed.
		const changed = analysis.nextChange(signal);
		yield analysis.readAnalysis();
		await changed;
	}
});

// Runs in the background; starting again while one runs does nothing.
export const startAnalysis = command(async () => analysis.startAnalysis());

export const resetAnalysis = command(async () => {
	try {
		analysis.resetAnalysis();
	} catch (err) {
		if (err instanceof analysis.AnalysisRunning) error(409, err.message);
		throw err;
	}
});
