import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextChange, resetAnalysis } from './analysis.server.js';

// Whether a promise has settled, once everything already queued has run.
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void promise.then(() => (settled = true));
	await vi.advanceTimersByTimeAsync(0);
	return settled;
}

describe('nextChange', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('waits for the analysis to change, then a moment for its burst of changes to settle', async () => {
		const waiting = nextChange(new AbortController().signal);
		expect(await isSettled(waiting)).toBe(false);
		// Resetting changes several parts of its state at once.
		resetAnalysis();
		await vi.advanceTimersByTimeAsync(249);
		expect(await isSettled(waiting)).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await isSettled(waiting)).toBe(true);
	});

	it('stops waiting as soon as its signal aborts, as when the page goes', async () => {
		const leaving = new AbortController();
		const waiting = nextChange(leaving.signal);
		leaving.abort();
		expect(await isSettled(waiting)).toBe(true);
	});

	it('does not wait at all for a signal already aborted', async () => {
		expect(await isSettled(nextChange(AbortSignal.abort()))).toBe(true);
	});
});
