import { describe, expect, it } from 'vitest';
import { lastKnown } from './lastKnown.server';

describe('lastKnown', () => {
	it('waits for the first answer, then gives the last while asking again', async () => {
		let n = 0;
		const check = lastKnown(`test-${Math.random()}`, async () => ++n);
		expect(await check.get()).toBe(1);
		expect(await check.get()).toBe(1);
		await Promise.resolve();
		expect(await check.get()).toBe(2);
	});

	it('waits for a fresh answer when asked for one', async () => {
		let n = 0;
		const check = lastKnown(`test-${Math.random()}`, async () => ++n);
		await check.get();
		expect(await check.fresh()).toBe(2);
	});

	it('runs one check at a time', async () => {
		let runs = 0;
		const check = lastKnown(`test-${Math.random()}`, async () => ++runs);
		await Promise.all([check.fresh(), check.fresh(), check.get()]);
		expect(runs).toBe(1);
	});
});
