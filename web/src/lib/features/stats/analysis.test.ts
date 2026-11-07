import { describe, expect, it } from 'vitest';
import { nextChange, resetAnalysis } from './analysis.server.js';

const settled = (promise: Promise<unknown>) => Promise.race([promise.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]);

describe('nextChange', () => {
	it('waits for the analysis to change, then for its burst of changes to settle', async () => {
		const waiting = nextChange(new AbortController().signal);
		expect(await settled(waiting)).toBe(false);
		// Resetting changes several parts of its state at once.
		resetAnalysis();
		expect(await settled(waiting)).toBe(false);
		await new Promise((r) => setTimeout(r, 300));
		expect(await settled(waiting)).toBe(true);
	});

	it('stops waiting as soon as its signal aborts, as when the page goes', async () => {
		const leaving = new AbortController();
		const waiting = nextChange(leaving.signal);
		leaving.abort();
		expect(await settled(waiting)).toBe(true);
	});

	it('does not wait at all for a signal already aborted', async () => {
		expect(await settled(nextChange(AbortSignal.abort()))).toBe(true);
	});
});
