import { describe, expect, it } from 'vitest';
import { scopeToRange } from './range.server';
import type { PrFile } from './github.server';

const file = (filename: string, patch?: string): PrFile => ({ filename, status: 'modified', additions: 0, deletions: 0, ...(patch ? { patch } : {}) });

// The PR adds lines 2-3 and 10 of a.ts; the range changed only line 3.
const pr = file('a.ts', ['@@ -1,2 +1,4 @@', ' one', '+two', '+three', ' four', '@@ -8,1 +10,2 @@', ' nine', '+ten'].join('\n'));

describe('scopeToRange', () => {
	it('keeps the hunks the range touched, and the lines it changed in them', () => {
		const range = file('a.ts', ['@@ -2,2 +2,2 @@', ' two', '-old three', '+three'].join('\n'));
		const [scoped] = scopeToRange([pr], [range]);
		expect(scoped.inRange).toEqual([0]);
		expect(scoped.rangeLines).toEqual({ old: [], new: [3] });
	});

	it("leaves out a file the range didn't change", () => {
		expect(scopeToRange([pr], [file('b.ts', '@@ -1 +1 @@\n-x\n+y')])).toEqual([]);
	});

	it("keeps what the range removed of the PR's own lines apart", () => {
		const range = file('a.ts', ['@@ -2,3 +2,2 @@', ' two', '-gone', ' three'].join('\n'));
		const [scoped] = scopeToRange([pr], [range]);
		expect(scoped.rangeRemoved).toEqual([{ at: 3, lines: ['gone'] }]);
		expect(scoped.inRange).toEqual([0]);
	});

	it('keeps a PR file without a diff the range changed, whole', () => {
		const binary = file('logo.png');
		expect(scopeToRange([binary], [file('logo.png', '@@ -1 +1 @@\n-a\n+b')])).toEqual([binary]);
		expect(scopeToRange([binary], [])).toEqual([]);
	});
});
