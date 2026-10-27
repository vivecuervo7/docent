import { describe, expect, it } from 'vitest';
import { summarise } from './summary';
import type { RoundStats } from './stats';

const round = (n: number, sizes: RoundStats['sizes'], extra: Partial<RoundStats> = {}): RoundStats => ({
	key: 'o/r/1',
	pr: { owner: 'o', repo: 'r', number: '1', title: 'A PR' },
	round: n,
	activity: [n * 1000],
	slices: sizes?.slices.length ?? 0,
	files: ['a.ts'],
	sliceFiles: sizes?.slices.map(() => 1) ?? [],
	sizes,
	reviewers: [],
	severities: {},
	questions: 0,
	comments: 0,
	conclusions: 0,
	answers: 0,
	postedComments: { yours: 0, panel: 0 },
	...extra
});

describe('summarise', () => {
	it('sizes a PR by its latest round, and adds up what its rounds read', () => {
		const s = summarise({
			rounds: [round(1, { lines: 2000, slices: [1000, 1000], pr: 2000 }), round(2, { lines: 200, slices: [200], pr: 2150 }), round(3, { lines: 200, slices: [200], pr: 2300 })]
		});
		const [pr] = s.reviewability.prs;
		expect(pr.size).toBe(2300);
		expect(pr.lines).toBe(2400);
		expect(s.reviewability.pr).toBe(2300);
		expect(pr.rounds).toBe(3);
	});

	it('falls back to what a round read when its PR size wasn\'t kept', () => {
		const s = summarise({ rounds: [round(1, { lines: 500, slices: [500] })] });
		expect(s.reviewability.prs[0].size).toBe(500);
	});

	it('counts how reviewers\' kept findings overlap', () => {
		const ran = [
			{ id: 'a', name: 'A' },
			{ id: 'b', name: 'B' }
		];
		const found = [
			{ by: 'a', kept: true, kickedBack: false, with: ['b'] },
			{ by: 'a', kept: true, kickedBack: false, with: [] },
			{ by: 'b', kept: false, kickedBack: true, with: [] }
		];
		const { overlap } = summarise({ rounds: [round(1, { lines: 10, slices: [10], pr: 10 }, { ran, found })] });
		const a = overlap.reviewers.find((r) => r.id === 'a');
		expect(a).toMatchObject({ kept: 2, alone: 1, kickedBack: 0 });
		expect(overlap.reviewers.some((r) => r.id === 'b')).toBe(false);
		expect(overlap.pairs[0]).toMatchObject({ a: 'a', b: 'b', aShared: 1, bShared: 0, together: 1 });
	});
});
