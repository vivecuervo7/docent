import type { RoundStats, Stats } from './stats';

// The stats page's figures, worked out from each round's, with a PR's
// rounds taken together: every round's lines were read again.

const DAY = 86_400_000;
const WEEK = 7 * DAY;

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

// Weeks back from this one, each with the PRs last worked on in it: from
// the first week anything was done, up to half a year.
function weeksOf(prs: PrStats[]) {
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
	const thisWeek = start.getTime();
	const first = Math.min(...prs.filter((p) => p.at).map((p) => p.at));
	const count = Math.min(26, Math.max(8, Math.ceil((thisWeek - first) / WEEK) + 1));
	return Array.from({ length: count }, (_, i) => {
		const from = thisWeek - (count - 1 - i) * WEEK;
		return { from, prs: prs.filter((p) => p.at >= from && p.at < from + WEEK).sort((a, b) => b.lines - a.lines) };
	});
}

export function summarise(stats: Stats) {
	const prs = byPr(stats.rounds).filter((p) => p.at > 0);
	const measured = prs.filter((p) => p.lines > 0 && p.slices.length);

	const byReviewer = new Map<string, { name: string; raised: number; kept: number; skipped: number; filtered: number }>();
	for (const r of stats.rounds)
		for (const v of r.reviewers) {
			const t = byReviewer.get(v.name) ?? { name: v.name, raised: 0, kept: 0, skipped: 0, filtered: 0 };
			t.raised += v.raised;
			t.kept += v.kept;
			t.skipped += v.skipped;
			t.filtered += v.filtered;
			byReviewer.set(v.name, t);
		}

	return {
		prs: prs.length,
		lines: sum(prs.map((p) => p.lines)),
		posted: sum(stats.rounds.map((r) => r.postedComments.yours + r.postedComments.panel)),
		questions: sum(stats.rounds.map((r) => r.questions)),
		weeks: weeksOf(prs),
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
