import { diffArrays, diffWordsWithSpace, parsePatch } from 'diff';
import type { LineRef } from '$lib/types';

// A file's diff as rows we render ourselves, parsed from the patch GitHub
// returns. Hunks keep their position in the patch, which is how slices refer
// to them (`path#index`).

export type RowKind = 'context' | 'add' | 'del';

export interface Row {
	key: string;
	kind: RowKind;
	old?: number;
	new?: number;
	text: string;
}

export interface Hunk {
	index: number;
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	rows: Row[];
}

export function parseFilePatch(patch: string): Hunk[] {
	if (!patch) return [];
	const headers = patch.split('\n').filter((line) => line.startsWith('@@'));
	const [parsed] = parsePatch(`--- a\n+++ b\n${patch}`);
	return (parsed?.hunks ?? []).map((hunk, index) => {
		let oldLine = hunk.oldStart;
		let newLine = hunk.newStart;
		const rows: Row[] = [];
		for (const line of hunk.lines) {
			const sign = line[0];
			const text = line.slice(1);
			// "\ No newline at end of file"
			if (sign === '\\') continue;
			if (sign === '+') rows.push({ key: `${index}+${newLine}`, kind: 'add', new: newLine++, text });
			else if (sign === '-') rows.push({ key: `${index}-${oldLine}`, kind: 'del', old: oldLine++, text });
			else rows.push({ key: `${index} ${oldLine}`, kind: 'context', old: oldLine++, new: newLine++, text });
		}
		const { oldStart, oldLines, newStart, newLines } = hunk;
		return { index, header: headers[index] ?? '', oldStart, oldLines, newStart, newLines, rows };
	});
}

export type Range = [start: number, end: number];

// The words that changed within a line, for each removed line paired with
// the added line that replaced it. Lines that were rewritten rather than
// edited get no marks: highlighting most of a line says less than none.
export function wordEdits(hunks: Hunk[]): Map<string, Range[]> {
	const edits = new Map<string, Range[]>();
	for (const hunk of hunks) {
		const { rows } = hunk;
		for (let i = 0; i < rows.length; ) {
			if (rows[i].kind !== 'del') {
				i++;
				continue;
			}
			const dels: Row[] = [];
			while (rows[i]?.kind === 'del') dels.push(rows[i++]);
			const adds: Row[] = [];
			while (rows[i]?.kind === 'add') adds.push(rows[i++]);
			for (let p = 0; p < Math.min(dels.length, adds.length); p++) pair(dels[p], adds[p], edits);
		}
	}
	return edits;
}

function pair(del: Row, add: Row, edits: Map<string, Range[]>) {
	const parts = diffWordsWithSpace(del.text, add.text);
	const common = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.trim().length, 0);
	const longest = Math.max(del.text.trim().length, add.text.trim().length);
	if (longest === 0 || common / longest < 0.4) return;
	const delRanges: Range[] = [];
	const addRanges: Range[] = [];
	let d = 0;
	let a = 0;
	for (const part of parts) {
		const n = part.value.length;
		if (part.removed) {
			delRanges.push([d, d + n]);
			d += n;
		} else if (part.added) {
			addRanges.push([a, a + n]);
			a += n;
		} else {
			d += n;
			a += n;
		}
	}
	if (delRanges.length) edits.set(del.key, delRanges);
	if (addRanges.length) edits.set(add.key, addRanges);
}

// Hunks that make the same change - the same lines removed and added - in
// several places. Past a few, they're shown once and the rest folded.
export function changeSignature(hunk: Hunk): string {
	return hunk.rows
		.filter((r) => r.kind !== 'context')
		.map((r) => `${r.kind === 'add' ? '+' : '-'}${r.text.trim()}`)
		.join('\n');
}

export type LayoutItem =
	| { type: 'hunk'; hunk: Hunk }
	| { type: 'fold'; id: string; hunks: Hunk[]; expanded: boolean };

export const FOLD_AT = 3;

export function layout(hunks: Hunk[], expanded: Set<string>): LayoutItem[] {
	const groups = new Map<string, Hunk[]>();
	for (const hunk of hunks) {
		const sig = changeSignature(hunk);
		groups.set(sig, [...(groups.get(sig) ?? []), hunk]);
	}
	const items: LayoutItem[] = [];
	for (const hunk of hunks) {
		const group = groups.get(changeSignature(hunk))!;
		if (group.length < FOLD_AT) {
			items.push({ type: 'hunk', hunk });
		} else if (group[0] === hunk) {
			const id = `fold-${hunk.index}`;
			items.push({ type: 'hunk', hunk });
			items.push({ type: 'fold', id, hunks: group.slice(1), expanded: expanded.has(id) });
		}
	}
	return items;
}

// Changes that only touch whitespace, shown as the unchanged lines they
// really are. A removed line and an added one that match once whitespace is
// ignored become one context line.
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function hideWhitespace(hunk: Hunk): Hunk {
	const rows: Row[] = [];
	const { rows: input } = hunk;
	for (let i = 0; i < input.length; ) {
		if (input[i].kind === 'context') {
			rows.push(input[i++]);
			continue;
		}
		const dels: Row[] = [];
		while (input[i]?.kind === 'del') dels.push(input[i++]);
		const adds: Row[] = [];
		while (input[i]?.kind === 'add') adds.push(input[i++]);
		const groups = diffArrays(dels, adds, { comparator: (a, b) => normalize(a.text) === normalize(b.text) });
		let d = 0;
		let a = 0;
		for (const group of groups) {
			const n = group.value.length;
			if (group.removed) for (let k = 0; k < n; k++) rows.push(dels[d++]);
			else if (group.added) for (let k = 0; k < n; k++) rows.push(adds[a++]);
			else
				for (let k = 0; k < n; k++) {
					const del = dels[d++];
					const add = adds[a++];
					rows.push({ key: `${hunk.index} ${del.old}`, kind: 'context', old: del.old, new: add.new, text: add.text });
				}
		}
	}
	return { ...hunk, rows };
}

// Showing unchanged lines around a hunk, GitHub-style. Expanded lines join
// that hunk's own rows rather than merging hunks, so hunk indices - which
// slices, review state and notes refer to - never change. Expansion stops at
// the neighbouring hunk even when it isn't shown (it may belong to another
// slice), so changed lines are never shown as context.

export const EXPAND_STEP = 20;

export interface Expansion {
	up: number;
	down: number;
}

// First and last old-file lines a hunk covers. One with no old lines
// ("-12,0") is an insertion after line 12, so these are the lines either side.
const firstOld = (h: Hunk) => (h.oldLines === 0 ? h.oldStart + 1 : h.oldStart);
const lastOld = (h: Hunk) => (h.oldLines === 0 ? h.oldStart : h.oldStart + h.oldLines - 1);
// new line = old line + offset, for unchanged lines above / below a hunk.
const offsetAbove = (h: Hunk) => (h.newLines === 0 ? h.newStart + 1 : h.newStart) - firstOld(h);
const offsetBelow = (h: Hunk) => offsetAbove(h) + h.newLines - h.oldLines;

// Unchanged lines between a hunk and the one before it, or the file's start.
export function gapAbove(all: Hunk[], i: number): number {
	const previousLast = i > 0 ? lastOld(all[i - 1]) : 0;
	return Math.max(0, firstOld(all[i]) - previousLast - 1);
}

// Unchanged lines between a hunk and the one after it, or the file's end.
export function gapBelow(all: Hunk[], i: number, totalLines: number): number {
	const nextFirst = i < all.length - 1 ? firstOld(all[i + 1]) : totalLines + 1;
	return Math.max(0, nextFirst - lastOld(all[i]) - 1);
}

export function fileLines(source: string): string[] {
	const lines = source.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

export function expandHunk(h: Hunk, { up, down }: Expansion, lines: string[]): Hunk {
	if (!up && !down) return h;
	const context = (old: number, offset: number): Row => ({
		key: `${h.index}~${old}`,
		kind: 'context',
		old,
		new: old + offset,
		text: lines[old - 1] ?? ''
	});
	const first = firstOld(h);
	const last = lastOld(h);
	const above = Array.from({ length: up }, (_, k) => context(first - up + k, offsetAbove(h)));
	const below = Array.from({ length: down }, (_, k) => context(last + 1 + k, offsetBelow(h)));
	return { ...h, rows: [...above, ...h.rows, ...below] };
}

// How far a hunk has to open to show a thread's lines, for threads begun on
// lines that were expanded at the time.
export function expansionFor(h: Hunk, start: LineRef, end: LineRef): Expansion {
	const first = firstOld(h);
	const last = lastOld(h);
	const firstNew = first + offsetAbove(h);
	const lastNew = last + offsetBelow(h);
	// Where a line falls outside the hunk, as an old-file line; null inside.
	const outside = ({ side, line }: LineRef): number | null => {
		if (side === 'old') return line < first || line > last ? line : null;
		if (line < firstNew) return line - offsetAbove(h);
		if (line > lastNew) return line - offsetBelow(h);
		return null;
	};
	const from = outside(start);
	const to = outside(end);
	return {
		up: from !== null && from < first ? first - from : 0,
		down: to !== null && to > last ? to - last : 0
	};
}
