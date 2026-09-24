import { diffWordsWithSpace, parsePatch } from 'diff';

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
		return { index, header: headers[index] ?? '', rows };
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
