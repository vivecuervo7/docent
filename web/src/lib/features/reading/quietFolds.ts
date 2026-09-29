import type { FileNote } from '$lib/types';
import type { Hunk, Row } from './diff/parse';

// Quiet, not hidden: code only worth skimming folds, and its row says
// what's inside.
// - Test files read as their scenarios: the code between the lines that
//   name a test folds, but only when it's wholly new or unchanged - an
//   edit or a deletion is what needs reading, so it stays open.
// - Imports and test setup fold whatever changed, with +/- on the row.
export type Piece = { type: 'row'; row: Row } | { type: 'fold'; id: string; rows: Row[]; label?: string };

const MIN_FOLD = 3;

export function quietPieces(hunk: Hunk, quietRanges: NonNullable<FileNote['quietRanges']>, scenarioLines: Set<number>): Piece[] {
	const { rows } = hunk;
	const onNew = (r: Row, from: number, to: number) => r.kind !== 'del' && r.new !== undefined && r.new >= from && r.new <= to;
	const uniform = (body: Row[]) => body.every((r) => r.kind === 'add') || body.every((r) => r.kind === 'context');
	const ranges: { from: number; to: number; label?: string }[] = [];
	for (const q of quietRanges) {
		const from = rows.findIndex((r) => onNew(r, q.startLine, q.endLine));
		const to = rows.findLastIndex((r) => onNew(r, q.startLine, q.endLine));
		// Setup, like test bodies, only folds when nothing in it was edited.
		if (from >= 0 && to - from + 1 >= MIN_FOLD && (q.kind === 'imports' || uniform(rows.slice(from, to + 1)))) {
			ranges.push({ from, to, label: q.kind });
		}
	}
	const titles = rows.flatMap((r, i) => (r.kind !== 'del' && r.new !== undefined && scenarioLines.has(r.new) ? [i] : []));
	titles.forEach((t, n) => {
		const end = n + 1 < titles.length ? titles[n + 1] : rows.length;
		const body = rows.slice(t + 1, end);
		if (body.length >= MIN_FOLD && uniform(body)) ranges.push({ from: t + 1, to: end - 1 });
	});
	ranges.sort((a, b) => a.from - b.from);
	const out: Piece[] = [];
	let i = 0;
	for (const range of ranges) {
		if (range.from < i) continue;
		for (; i < range.from; i++) out.push({ type: 'row', row: rows[i] });
		out.push({ type: 'fold', id: `${hunk.index}:${range.from}`, rows: rows.slice(range.from, range.to + 1), label: range.label });
		i = range.to + 1;
	}
	for (; i < rows.length; i++) out.push({ type: 'row', row: rows[i] });
	return out;
}
