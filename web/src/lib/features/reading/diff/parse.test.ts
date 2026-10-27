import { describe, expect, it } from 'vitest';
import { codeIn, nearestHunk, parseFilePatch } from './parse';

const patch = ['@@ -1,3 +1,4 @@', ' one', '-two', '+TWO', '+two and a half', ' three', '@@ -10,2 +11,2 @@', ' ten', '-eleven', '+ELEVEN'].join('\n');

describe('parseFilePatch', () => {
	const hunks = parseFilePatch(patch);

	it('splits a patch into hunks, numbered from 0', () => {
		expect(hunks.map((h) => [h.index, h.oldStart, h.newStart])).toEqual([
			[0, 1, 1],
			[1, 10, 11]
		]);
	});

	it('numbers each row on its side', () => {
		expect(hunks[0].rows.map((r) => [r.kind, r.old, r.new])).toEqual([
			['context', 1, 1],
			['del', 2, undefined],
			['add', undefined, 2],
			['add', undefined, 3],
			['context', 3, 4]
		]);
	});

	it('reads no patch as no hunks', () => {
		expect(parseFilePatch('')).toEqual([]);
	});
});

describe('codeIn', () => {
	it('gives the lines between two, with their markers', () => {
		const [hunk] = parseFilePatch(patch);
		expect(codeIn(hunk, { side: 'new', line: 2 }, { side: 'new', line: 4 })).toBe('+TWO\n+two and a half\n three');
	});
});

describe('nearestHunk', () => {
	const hunks = parseFilePatch(patch);

	it('finds the hunk holding a line', () => {
		expect(nearestHunk(hunks, { side: 'new', line: 12 })?.index).toBe(1);
	});

	it('falls back to the nearest for a line outside the diff', () => {
		expect(nearestHunk(hunks, { side: 'new', line: 6 })?.index).toBe(0);
	});
});
