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
	files?: string[];
	sliceFiles?: number[];
	// Lines its changes touched, and each slice's share; and the lines of the
	// PR's whole diff as it read it, whichever commits it covered.
	sizes?: { lines: number; slices: number[]; pr?: number };
	// By persona or external reviewer, which their ids name.
	// Of those skipped, kicked back: skipped though its reviewer and the
	// editor stood by it. Missing from figures taken before it was counted.
	reviewers: { name: string; persona?: string; external?: string; raised: number; kept: number; skipped: number; kickedBack?: number; filtered: number }[];
	severities: Partial<Record<Severity, number>>;
	questions: number;
	comments: number;
	conclusions: number;
	answers: number;
	// How the figures were counted, for taking them again when that changes.
	counted?: number;
	// Each finding the editor didn't filter out: who raised it, whether it's
	// kept or you kicked it back, and whose findings it was grouped with as
	// the same point.
	found?: { by: string; kept: boolean; kickedBack: boolean; with: string[] }[];
	// The reviewers that ran on the round.
	ran?: { id: string; name: string; persona?: string; external?: string }[];
	postedComments: { yours: number; panel: number };
}

export interface Stats {
	rounds: RoundStats[];
}

// The broad kinds of feedback, for telling what reviewers raise and what
// they miss: every finding and comment is put under one.
export const THEMES = ['correctness', 'reliability', 'security', 'tests', 'design', 'build'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = {
	correctness: 'Correctness',
	reliability: 'Reliability',
	security: 'Security',
	tests: 'Tests',
	design: 'Design and clarity',
	build: 'Build and config'
};

// What analysing reviewer performance has found so far.
export interface Analysis {
	status: { running: boolean; phase?: 'themes' | 'gaps'; done: number; total: number; error?: string; finishedAt?: number };
	// Findings not yet given a theme, and PRs with comments by others not yet judged.
	pending: { findings: number };
	themes: {
		// Kept findings by theme, across every reviewer, and each reviewer's.
		overall: Partial<Record<Theme, number>>;
		byReviewer: Record<string, Partial<Record<Theme, number>>>;
	};
	// Points others raised after the panel had reviewed, by theme: raised by
	// the panel and kept or left to you, raised but set aside by the panel
	// itself, or missed.
	gaps: { byTheme: Partial<Record<Theme, { caught: number; setAside: number; missed: number }>> };
}
