import { SEVERITY_ORDER, type Severity } from '../../types';
import type { RoundStats, Stats } from './stats';

// The stats page's figures, worked out from each round's.

const DAY = 86_400_000;

export const dayKey = (at: number) => {
	const d = new Date(at);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

// How much was done each day, for the activity map.
export function activityByDay(rounds: RoundStats[]): Map<string, number> {
	const days = new Map<string, number>();
	for (const r of rounds) for (const at of r.activity) days.set(dayKey(at), (days.get(dayKey(at)) ?? 0) + 1);
	return days;
}

// The most days in a row with something done.
function longestStreak(days: Map<string, number>): number {
	const dates = [...days.keys()]
		.map((k) => {
			const [y, m, d] = k.split('-').map(Number);
			return new Date(y, m, d).getTime();
		})
		.sort((a, b) => a - b);
	let best = 0;
	let run = 0;
	let last = -Infinity;
	for (const t of dates) {
		run = Math.round((t - last) / DAY) === 1 ? run + 1 : 1;
		best = Math.max(best, run);
		last = t;
	}
	return best;
}

export function summarise(stats: Stats) {
	const { rounds } = stats;
	const yearAgo = Date.now() - 365 * DAY;
	const finished = (r: RoundStats) => r.posted ?? r.completed;
	const prs = new Set(rounds.map((r) => `${r.pr.owner}/${r.pr.repo}#${r.pr.number}`));
	const days = activityByDay(rounds);

	const measured = rounds.filter((r) => r.sizes && r.slices > 0 && r.sizes.lines > 0);
	const sliceSizes = measured.flatMap((r) => r.sizes!.slices.filter((n) => n > 0));

	const byReviewer = new Map<string, { name: string; raised: number; kept: number; skipped: number; filtered: number }>();
	for (const r of rounds)
		for (const v of r.reviewers) {
			const t = byReviewer.get(v.name) ?? { name: v.name, raised: 0, kept: 0, skipped: 0, filtered: 0 };
			t.raised += v.raised;
			t.kept += v.kept;
			t.skipped += v.skipped;
			t.filtered += v.filtered;
			byReviewer.set(v.name, t);
		}

	const severities = new Map<Severity, number>();
	for (const r of rounds) for (const [s, n] of Object.entries(r.severities) as [Severity, number][]) severities.set(s, (severities.get(s) ?? 0) + n);
	const commonest = [...severities.entries()].sort((a, b) => b[1] - a[1] || SEVERITY_ORDER.indexOf(a[0]) - SEVERITY_ORDER.indexOf(b[0]))[0]?.[0];

	return {
		reviewsThisYear: rounds.filter((r) => (finished(r) ?? 0) >= yearAgo).length,
		days,
		prs: prs.size,
		rounds: rounds.filter(finished).length,
		lines: sum(measured.map((r) => r.sizes!.lines)),
		posted: { yours: sum(rounds.map((r) => r.postedComments.yours)), panel: sum(rounds.map((r) => r.postedComments.panel)) },
		reviewability: {
			pr: Math.round(mean(measured.map((r) => r.sizes!.lines))),
			slice: Math.round(mean(sliceSizes)),
			rounds: measured
				.map((r) => ({ title: r.pr.title, round: r.round, lines: r.sizes!.lines, slice: Math.round(mean(r.sizes!.slices.filter((n) => n > 0))), slices: r.slices }))
				.sort((a, b) => a.lines - b.lines)
		},
		reviewers: [...byReviewer.values()].filter((r) => r.raised > 0).sort((a, b) => b.raised - a.raised),
		tidbits: {
			questions: sum(rounds.map((r) => r.questions)),
			comments: sum(rounds.map((r) => r.comments)),
			conclusions: sum(rounds.map((r) => r.conclusions)),
			calls: stats.calls.length,
			checks: sum(rounds.map((r) => r.checks)),
			resolved: stats.resolved.length,
			streak: longestStreak(days),
			severity: commonest
		}
	};
}
