import type { RoundStats, Stats } from './stats';

// The stats page's figures, worked out from each round's, with a PR's
// rounds taken together: every round's lines were read again. A PR's size
// is its own, as its latest round read it, not those rounds added up.

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export interface PrStats {
	id: string;
	title: string;
	// Lines in its diff, as its latest round read it; lines read across its
	// rounds; and the size of each slice they had.
	size: number;
	lines: number;
	slices: number[];
	// The files read across its rounds, and how many each slice covered.
	files: number;
	sliceFiles: number[];
	rounds: number;
	// When it was last worked on.
	at: number;
}

function byPr(rounds: RoundStats[]): PrStats[] {
	const prs = new Map<string, { rounds: RoundStats[] }>();
	for (const r of rounds) {
		const id = `${r.pr.owner}/${r.pr.repo}#${r.pr.number}`;
		prs.set(id, { rounds: [...(prs.get(id)?.rounds ?? []), r] });
	}
	return [...prs.entries()].map(([id, { rounds: rs }]) => {
		const latest = [...rs].sort((a, b) => b.round - a.round)[0];
		const times = rs.flatMap((r) => [...r.activity, r.posted ?? 0, r.completed ?? 0]);
		return {
			id,
			title: latest.pr.title,
			// A round measured before its PR's size was kept, as a review
			// since deleted can't be measured again, gives what it read.
			size: latest.sizes?.pr ?? latest.sizes?.lines ?? 0,
			lines: sum(rs.map((r) => r.sizes?.lines ?? 0)),
			slices: rs.flatMap((r) => r.sizes?.slices.filter((n) => n > 0) ?? []),
			files: new Set(rs.flatMap((r) => r.files ?? [])).size,
			sliceFiles: rs.flatMap((r) => r.sliceFiles ?? []),
			rounds: rs.length,
			at: Math.max(0, ...times)
		};
	});
}

// How reviewers' kept findings overlap: each reviewer by the findings of
// theirs you kept and kicked back, and each pair by how many of each one's
// kept findings the other corroborated, on the rounds they reviewed together.
export interface OverlapReviewer {
	id: string;
	name: string;
	kept: number;
	kickedBack: number;
	// Kept findings no other reviewer raised.
	alone: number;
	rounds: number;
}
export interface OverlapPair {
	a: string;
	b: string;
	// a's kept findings b corroborated, and b's a did.
	aShared: number;
	bShared: number;
	together: number;
}

function overlapOf(rounds: RoundStats[]) {
	const reviewers = new Map<string, OverlapReviewer>();
	const pairs = new Map<string, OverlapPair>();
	const pair = (a: string, b: string) => {
		const [x, y] = [a, b].sort();
		const key = `${x}\u0000${y}`;
		const p = pairs.get(key) ?? { a: x, b: y, aShared: 0, bShared: 0, together: 0 };
		pairs.set(key, p);
		return p;
	};
	for (const r of rounds) {
		if (!r.found || !r.ran) continue;
		for (const v of r.ran) {
			const t = reviewers.get(v.id) ?? { id: v.id, name: v.name, kept: 0, kickedBack: 0, alone: 0, rounds: 0 };
			t.rounds++;
			reviewers.set(v.id, t);
		}
		for (let i = 0; i < r.ran.length; i++) for (let j = i + 1; j < r.ran.length; j++) pair(r.ran[i].id, r.ran[j].id).together++;
		for (const f of r.found) {
			const t = reviewers.get(f.by);
			if (!t) continue;
			if (f.kickedBack) t.kickedBack++;
			if (!f.kept) continue;
			t.kept++;
			if (!f.with.length) t.alone++;
			for (const other of f.with) {
				const p = pair(f.by, other);
				if (p.a === f.by) p.aShared++;
				else p.bShared++;
			}
		}
	}
	return { reviewers: [...reviewers.values()].filter((r) => r.kept > 0), pairs: [...pairs.values()] };
}

export function summarise(stats: Stats) {
	const prs = byPr(stats.rounds).filter((p) => p.at > 0);
	const measured = prs.filter((p) => p.lines > 0 && p.slices.length);

	const byReviewer = new Map<string, { id: string; name: string; raised: number; kept: number; asSuggested: number; kickedBack: number; filtered: number }>();
	for (const r of stats.rounds)
		for (const v of r.reviewers) {
			// One reviewer by its persona or external reviewer's id, so two that
			// share a name stay apart.
			const id = v.persona ?? v.external ?? v.name;
			const t = byReviewer.get(id) ?? { id, name: v.name, raised: 0, kept: 0, asSuggested: 0, kickedBack: 0, filtered: 0 };
			const kickedBack = v.kickedBack ?? v.skipped;
			t.raised += v.raised;
			t.kept += v.kept;
			t.kickedBack += kickedBack;
			t.asSuggested += v.skipped - kickedBack;
			t.filtered += v.filtered;
			byReviewer.set(id, t);
		}

	return {
		prs: prs.length,
		lines: sum(prs.map((p) => p.lines)),
		posted: sum(stats.rounds.map((r) => r.postedComments.yours + r.postedComments.panel)),
		slices: sum(stats.rounds.map((r) => r.slices)),
		reviewability: {
			pr: Math.round(mean(measured.map((p) => p.size))),
			slice: Math.round(mean(measured.flatMap((p) => p.slices))),
			files: Math.round(mean(measured.map((p) => p.files))),
			sliceFiles: mean(measured.flatMap((p) => p.sliceFiles)),
			prs: measured
				.map((p) => ({
					title: p.title,
					size: p.size,
					lines: p.lines,
					slice: Math.round(mean(p.slices)),
					slices: p.slices.length,
					largest: Math.max(...p.slices),
					files: p.files,
					rounds: p.rounds
				}))
				.sort((a, b) => a.size - b.size)
		},
		reviewers: [...byReviewer.values()].filter((r) => r.raised > 0).sort((a, b) => b.raised - a.raised),
		overlap: overlapOf(stats.rounds)
	};
}
