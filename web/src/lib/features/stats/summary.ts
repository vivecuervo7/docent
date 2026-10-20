import type { RoundStats, Stats } from './stats';

// The stats page's figures, worked out from each round's, with a PR's
// rounds taken together: every round's lines were read again.

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export interface PrStats {
	id: string;
	title: string;
	// Lines read across its rounds, and the size of each slice they had.
	lines: number;
	slices: number[];
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
			lines: sum(rs.map((r) => r.sizes?.lines ?? 0)),
			slices: rs.flatMap((r) => r.sizes?.slices.filter((n) => n > 0) ?? []),
			at: Math.max(0, ...times)
		};
	});
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
			pr: Math.round(mean(measured.map((p) => p.lines))),
			slice: Math.round(mean(measured.flatMap((p) => p.slices))),
			prs: measured
				.map((p) => ({ title: p.title, lines: p.lines, slice: Math.round(mean(p.slices)), slices: p.slices.length }))
				.sort((a, b) => a.lines - b.lines)
		},
		reviewers: [...byReviewer.values()].filter((r) => r.raised > 0).sort((a, b) => b.raised - a.raised)
	};
}
