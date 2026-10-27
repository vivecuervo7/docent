import { reviewerName } from './names';
import type { AgentId, AgentReviewer } from '../../types';

// How a review panel's reviewers are set up and named, the same on the page
// and on the backend.

// Sessions were saved as "persona:<id>" before personas meant Docent's own
// reviewer; the ids carried over.
export const sessionId = (value: string | undefined) =>
	value?.startsWith('session:') ? value.slice('session:'.length) : value?.startsWith('persona:') ? value.slice('persona:'.length) : null;

// What runs a reviewer: Docent's reviewer on a model, with a persona (none
// is the default); one of the reviewer's external reviewers, a session of
// their own tooling; or their own agent, over MCP.
export type ReviewerSetup =
	| { mode: 'builtin'; model: string; persona?: string }
	| { mode: 'external' }
	| { mode: 'session'; session: string };

// The persona that picks personas: the ones the PR warrants, beyond those
// already on the panel, run on the reviewer's model.
export const AUTO_PERSONA = 'auto';
export const isAuto = (r: { persona?: string }) => r.persona === AUTO_PERSONA;

// Docent's reviewer with a point of view.
export interface Persona {
	id: string;
	name: string;
	instructions: string;
}

// The reviewer's own prompt or skill, run as a Claude Code or Codex session,
// or a prompt run directly on a provider's model.
export interface ExternalReviewer {
	id: string;
	name: string;
	runner: 'claude-code' | 'codex' | 'provider';
	command: string;
	provider?: string;
	model?: string;
	tools?: string;
}

// A reviewer in the default panel.
export interface PanelEntry {
	runs: string;
	persona?: string;
	// Starts switched off on every new PR.
	off?: boolean;
}

export function setupOfValue(runs: string | undefined, persona: string | undefined, defaultModel: string): ReviewerSetup {
	if (runs === 'external') return { mode: 'external' };
	const session = sessionId(runs);
	if (session) return { mode: 'session', session };
	return { mode: 'builtin', model: runs ?? defaultModel, ...(persona ? { persona } : {}) };
}

// Whether Docent's own reviewer runs it, rather than an external one.
export function isDocents(a: AgentReviewer): boolean {
	const runs = a.planned ?? a.ranWith;
	return runs !== 'external' && !sessionId(runs);
}

export function setupFrom(reviewer: AgentReviewer, defaultModel: string): ReviewerSetup {
	return setupOfValue(reviewer.planned ?? reviewer.ranWith, reviewer.persona, defaultModel);
}

// A reviewer's setup as one value: its model, `session:<id>`, or `external`.
export const setupValue = (setup: ReviewerSetup) =>
	setup.mode === 'external' ? 'external' : setup.mode === 'session' ? `session:${setup.session}` : setup.model;

export const entryOf = (setup: ReviewerSetup, off?: boolean): PanelEntry => ({
	runs: setupValue(setup),
	...(setup.mode === 'builtin' && setup.persona ? { persona: setup.persona } : {}),
	...(off ? { off: true } : {})
});

// A reviewer as the default panel gives it.
export const reviewerFrom = (entry: PanelEntry, id: AgentId): AgentReviewer => {
	const session = sessionId(entry.runs);
	return {
		id,
		planned: session ? `session:${session}` : entry.runs,
		...(entry.persona ? { persona: entry.persona } : {}),
		...(entry.off ? { off: true } : {})
	};
};

// A model's name without where it runs: Claude Code's or Codex's prefix,
// or the provider id it's saved with.
export function modelLabel(model: string): string {
	const name = model.replace(/^(claude-code|codex|p[0-9a-f]{6}):/, '');
	return name.slice(name.lastIndexOf('/') + 1);
}

export function nameAll(record: { agentReviewers: AgentReviewer[]; agentNamesUsed?: string[] }) {
	const used = new Set([...(record.agentNamesUsed ?? []), ...record.agentReviewers.flatMap((r) => (r.name ? [r.name] : []))]);
	record.agentReviewers = record.agentReviewers.map((r) => {
		if (r.name) return r;
		const name = reviewerName(used);
		used.add(name);
		return { ...r, name };
	});
	record.agentNamesUsed = [...used];
}
