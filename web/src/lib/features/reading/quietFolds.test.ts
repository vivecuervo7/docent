import { describe, expect, it } from 'vitest';
import type { Mark } from './marks';
import { foldedFinding } from './quietFolds';

const line = { side: 'new' as const, line: 1 };
const finding = (over: Partial<Mark> = {}): Mark => ({
	id: 'f',
	kind: 'finding',
	path: 'a',
	start: line,
	end: line,
	who: '',
	body: '',
	included: true,
	...over
});

describe('foldedFinding', () => {
	it('has nothing without findings', () => {
		expect(foldedFinding([])).toBeNull();
		expect(foldedFinding([finding({ kind: 'note' }), finding({ kind: 'github' })])).toBeNull();
	});

	it('draws a filtered-out finding as filtered, whatever it was kept as', () => {
		expect(foldedFinding([finding({ filtered: 'Trivial' })])?.state).toBe('filtered');
		expect(foldedFinding([finding({ filtered: 'Trivial', included: false })])?.state).toBe('filtered');
	});

	it('draws a skipped finding, or one suggested for skipping, as skipped', () => {
		expect(foldedFinding([finding({ included: false, skipSuggested: 'Minor' })])?.state).toBe('skipped');
		expect(foldedFinding([finding({ included: false, decided: true })])?.state).toBe('skipped');
	});

	it('draws the one that matters most', () => {
		expect(foldedFinding([finding({ filtered: 'Trivial' }), finding({ included: false })])?.state).toBe('skipped');
		expect(foldedFinding([finding({ filtered: 'Trivial' }), finding({ included: false }), finding()])?.state).toBe('kept');
	});

	it('counts them, and is unread if any is', () => {
		expect(foldedFinding([finding({ filtered: 'Trivial', unread: true }), finding()])).toEqual({ state: 'kept', count: 2, unread: true });
	});
});
