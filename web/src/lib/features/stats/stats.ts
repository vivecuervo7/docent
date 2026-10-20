import type { Severity } from '../../types';

// What the stats page reads: each round's figures.

export interface RoundStats {
	key: string;
	pr: { owner: string; repo: string; number: string; title: string };
	round: number;
	// When something was done in it: asked, commented, concluded, posted, completed.
	activity: number[];
	posted?: number;
	completed?: number;
	slices: number;
	// Lines its changes touched, and each slice's share.
	sizes?: { lines: number; slices: number[] };
	// By persona or external reviewer, which their ids name.
	reviewers: { name: string; persona?: string; external?: string; raised: number; kept: number; skipped: number; filtered: number }[];
	severities: Partial<Record<Severity, number>>;
	questions: number;
	comments: number;
	conclusions: number;
	answers: number;
	checks: number;
	postedComments: { yours: number; panel: number };
}

export interface Stats {
	rounds: RoundStats[];
}
