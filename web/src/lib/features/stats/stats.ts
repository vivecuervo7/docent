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
	// Of those skipped, kicked back: skipped though its reviewer and the
	// editor stood by it. Missing from figures taken before it was counted.
	reviewers: { name: string; persona?: string; external?: string; raised: number; kept: number; skipped: number; kickedBack?: number; filtered: number }[];
	severities: Partial<Record<Severity, number>>;
	questions: number;
	comments: number;
	conclusions: number;
	answers: number;
	checks: number;
	// Each point raised - the editor's group of findings making it - by the
	// reviewers raising it, and whether you kept or skipped it.
	points?: { by: string[]; kept: boolean; skipped: boolean }[];
	// The reviewers that ran on the round.
	ran?: { id: string; name: string; persona?: string; external?: string }[];
	postedComments: { yours: number; panel: number };
}

export interface Stats {
	rounds: RoundStats[];
}
