import { describe, expect, it } from 'vitest';
import { coverage, spanOf } from './coverage';

const commits = (...shas: string[]) => shas.map((sha) => ({ sha, merge: sha.startsWith('m') }));

describe('spanOf', () => {
	const all = commits('a', 'b', 'c', 'd');

	it('covers the commits after a range starts, up to its end', () => {
		expect(spanOf(all, { range: { after: 'a', to: 'c' } }, false)).toEqual({ from: 0, to: 2 });
	});

	it('reads a round with no range up to the commit it ended on', () => {
		expect(spanOf(all, { end: 'b' }, false)).toEqual({ from: -1, to: 1 });
	});

	it('takes an end missing from a list cut to the latest hundred as all of them', () => {
		expect(spanOf(all, { end: 'gone' }, true)).toEqual({ from: -1, to: 3 });
	});

	it('takes an end missing from the whole list as rebased away, covering none', () => {
		expect(spanOf(all, { end: 'gone' }, false)).toEqual({ from: -1, to: -1 });
	});

	it('covers nothing for a round not begun', () => {
		expect(spanOf(all, {}, false)).toEqual({ from: -1, to: -1 });
	});
});

describe('coverage', () => {
	it('counts commits after every round as fresh, merges left out', () => {
		const all = commits('a', 'b', 'm1', 'c', 'd');
		const covered = coverage(all, [{ end: 'b' }]);
		expect(covered.commits.map((c) => [c.sha, c.round, c.fresh])).toEqual([
			['a', 0, false],
			['b', 0, false],
			['c', null, true],
			['d', null, true]
		]);
		expect(covered.fresh).toBe(2);
	});

	it('gives each commit the newest round that covers it', () => {
		const covered = coverage(commits('a', 'b', 'c'), [{ end: 'b' }, { range: { after: 'b', to: 'c' } }]);
		expect(covered.commits.map((c) => c.round)).toEqual([0, 0, 1]);
		expect(covered.fresh).toBe(0);
	});

	it('counts every commit as fresh after a rebase', () => {
		const covered = coverage(commits('x', 'y'), [{ end: 'old-head' }]);
		expect(covered.fresh).toBe(2);
	});

	it('counts a rebased round covering the new commits as covering them all', () => {
		const covered = coverage(commits('x', 'y'), [{ end: 'old-head' }, { range: { after: 'old-head', to: 'y' } }]);
		expect(covered.fresh).toBe(0);
		expect(covered.commits.map((c) => c.round)).toEqual([1, 1]);
	});
});
