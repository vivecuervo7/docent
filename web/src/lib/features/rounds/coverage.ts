// Which round covers each of a PR's commits. Rounds are given oldest first,
// each by its range or the commit it reads up to (none for one not begun);
// commits oldest first, merges included, since a round can end on one. Only
// commits that aren't merges are shown: those bring in the base branch.

export interface RoundEnds {
	range?: { after: string; to: string };
	end?: string;
}

export interface Coverage {
	// Each shown commit, with the newest round covering it, and whether it
	// came after every round.
	commits: { sha: string; k: number; round: number | null; fresh: boolean }[];
	// Each round's commits, as positions in `all`: after `from`, up to `to`.
	spans: { from: number; to: number }[];
	// Commits after every round.
	fresh: number;
}

export function coverage(all: { sha: string; merge: boolean }[], rounds: RoundEnds[]): Coverage {
	const at = (sha: string | undefined) => (sha ? all.findIndex((c) => c.sha === sha) : -1);
	const spans = rounds.map((r) => {
		const end = r.range?.to ?? r.end;
		const to = end ? at(end) : -1;
		// A commit not among these - older than the last hundred - is taken as all of them.
		return { from: r.range ? at(r.range.after) : -1, to: end && to < 0 ? all.length - 1 : to };
	});
	const last = Math.max(-1, ...spans.map((s) => s.to));
	const commits = all.flatMap((c, k) => {
		if (c.merge) return [];
		const holder = spans.findLastIndex((s) => k > s.from && k <= s.to);
		return [{ sha: c.sha, k, round: holder >= 0 ? holder : null, fresh: k > last }];
	});
	return { commits, spans, fresh: commits.filter((c) => c.fresh).length };
}
