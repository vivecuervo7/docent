import * as api from './api';
import { reviewerName } from './names';
import type { PrSession } from './session.svelte';
import { FIRST_AGENT, type AgentId, type AgentReview, type AgentReviewer, type FeedbackDraft } from './types';

// The PR's review panel: its agent reviewers (saved in the record, shared
// with the React app), the review each is running, and copying their
// findings into the record as they arrive.

export type ReviewerSetup = { mode: 'builtin'; model: string } | { mode: 'external' } | { mode: 'persona'; persona: string };

// A review persona, as Settings defines it.
export interface Persona {
	id: string;
	name: string;
	command: string;
	model?: string;
	tools?: string;
}

export function setupFrom(reviewer: AgentReviewer, defaultModel: string): ReviewerSetup {
	const chosen = reviewer.planned ?? reviewer.ranWith;
	if (chosen === 'external') return { mode: 'external' };
	if (chosen?.startsWith('persona:')) return { mode: 'persona', persona: chosen.slice('persona:'.length) };
	return { mode: 'builtin', model: chosen ?? defaultModel };
}

const setupValue = (setup: ReviewerSetup) =>
	setup.mode === 'external' ? 'external' : setup.mode === 'persona' ? `persona:${setup.persona}` : setup.model;

// A model's name without where it runs: Claude Code's or Codex's prefix,
// or the provider id it's saved with.
export function modelLabel(model: string): string {
	const name = model.replace(/^(claude-code|codex|p[0-9a-f]{6}):/, '');
	return name.slice(name.lastIndexOf('/') + 1);
}

export const nameOf = (reviewer: AgentReviewer) => reviewer.name ?? reviewer.id;

// What to tell the reviewer's own agent after its review, to send the
// findings here. It names the reviewer, so two agents can't be mixed up.
export function agentInstruction(session: PrSession, reviewer: AgentReviewer): string {
	const { owner, repo, number } = session.ref;
	return `Send these review findings to Docent for ${owner}/${repo}#${number} as ${nameOf(reviewer)}.`;
}

function nameAll(record: { agentReviewers: AgentReviewer[]; agentNamesUsed?: string[] }) {
	const used = new Set([...(record.agentNamesUsed ?? []), ...record.agentReviewers.flatMap((r) => (r.name ? [r.name] : []))]);
	record.agentReviewers = record.agentReviewers.map((r) => {
		if (r.name) return r;
		const name = reviewerName(used);
		used.add(name);
		return { ...r, name };
	});
	record.agentNamesUsed = [...used];
}

export class Panel {
	#session: PrSession;
	reviews = $state<Partial<Record<AgentId, AgentReview>>>({});
	errors = $state<Partial<Record<AgentId, string>>>({});
	defaultPanel = $state<string[] | null>(null);
	personas = $state<Persona[]>([]);

	readonly reviewers = $derived.by(() => this.#session.record.agentReviewers);
	readonly running = $derived.by(() => this.reviewers.filter((r) => this.reviews[r.id]?.status === 'running'));
	readonly findingCount = $derived.by(() =>
		this.reviewers.reduce((n, r) => n + (this.#session.record.feedback[r.id]?.items.length ?? 0), 0)
	);

	// Findings already copied into the record, by review, so each lands once.
	#seen: Partial<Record<AgentId, { id: string; count: number }>> = {};
	// Removed while a check-in was in flight: their findings mustn't return.
	#removed = new Set<AgentId>();
	#poll: ReturnType<typeof setInterval> | null = null;

	constructor(session: PrSession) {
		this.#session = session;
	}

	// Names any reviewers from before names, and picks up reviews still
	// running from an earlier visit.
	async load() {
		fetch('/api/personas')
			.then((res) => api.readOk<{ personas: Persona[] }>(res))
			.then((r) => (this.personas = r.personas))
			.catch(() => {});
		this.defaultPanel = await api.getDefaultPanel().catch(() => null);
		if (this.reviewers.some((r) => !r.name)) this.#session.update(nameAll).catch(() => {});
		await Promise.all(
			this.reviewers.map(async ({ id }) => {
				const review = await api.getAgentReview(this.#session.ref, id).catch(() => null);
				if (review) this.#collect(id, review);
			})
		);
	}

	close() {
		this.#stopPolling();
	}

	// Whether the panel is as a new PR starts it: one reviewer, never run or
	// changed.
	#untouched(r: { panelSettled?: boolean; agentReviewers: AgentReviewer[]; feedback: Record<string, FeedbackDraft | undefined> }) {
		return (
			!r.panelSettled &&
			r.agentReviewers.length <= 1 &&
			r.agentReviewers.every((a) => !a.ranWith && !a.planned && !a.lastRun && !r.feedback[a.id]?.items.length)
		);
	}

	// Gives a PR the default panel once it's prepared, fetching the default
	// then, so one saved while other PRs were still preparing reaches them.
	async applyDefault() {
		if (!this.#untouched(this.#session.record)) return;
		const saved = await api.getDefaultPanel().catch(() => null);
		this.defaultPanel = saved;
		await this.#session
			.update((r) => {
				if (!this.#untouched(r)) return;
				r.panelSettled = true;
				if (saved?.length) r.agentReviewers = saved.map((planned, i) => ({ id: `agent-${i + 1}`, planned }));
				r.agentHighest = Math.max(r.agentHighest ?? 0, r.agentReviewers.length);
				nameAll(r);
			})
			.catch(() => {});
	}

	// The default can replace a panel none of whose reviewers has run yet.
	canUseDefault(defaultModel: string): boolean {
		return (
			!!this.defaultPanel?.length &&
			!this.isDefault(defaultModel) &&
			this.reviewers.every((a) => !a.ranWith && !a.lastRun && !this.findings(a.id) && !this.reviews[a.id])
		);
	}

	async useDefault() {
		const saved = this.defaultPanel;
		if (!saved?.length) return;
		await this.#session.update((r) => {
			const highest = Math.max(0, r.agentHighest ?? 0, ...r.agentReviewers.map((a) => Number(a.id.slice('agent-'.length))));
			// Keeps the first reviewer's id; the rest get fresh numbers, never reused.
			r.agentReviewers = saved.map((planned, i) => ({ id: i === 0 ? FIRST_AGENT : `agent-${highest + i}`, planned }));
			r.agentHighest = highest + saved.length - 1;
			r.panelSettled = true;
			nameAll(r);
		});
	}

	findings(id: AgentId): number {
		return this.#session.record.feedback[id]?.items.length ?? 0;
	}

	async start(id: AgentId, setup: ReviewerSetup) {
		const session = this.#session;
		this.errors[id] = undefined;
		try {
			const review = await api.startAgentReview(session.ref, id, {
				...setup,
				context: { title: session.title, summary: session.record.summary, slices: session.slices }
			});
			delete this.#seen[id];
			this.#collect(id, review);
			const ranWith = setupValue(setup);
			session.update((r) => {
				r.agentReviewers = r.agentReviewers.map((a) => (a.id === id ? { ...a, ranWith, planned: undefined } : a));
				r.panelSettled = true;
			});
		} catch (err) {
			this.errors[id] = (err as Error).message;
		}
	}

	// What a reviewer runs with next.
	plan(id: AgentId, setup: ReviewerSetup) {
		const planned = setupValue(setup);
		this.#session
			.update((r) => {
				r.agentReviewers = r.agentReviewers.map((a) => (a.id === id ? { ...a, planned } : a));
				r.panelSettled = true;
			})
			.catch(() => {});
	}

	// This PR's panel, as what every new PR starts with.
	async saveAsDefault(defaultModel: string) {
		const panel = this.reviewers.map((r) => setupValue(setupFrom(r, defaultModel)));
		this.defaultPanel = await api.setDefaultPanel(panel);
	}

	isDefault(defaultModel: string): boolean {
		const panel = this.reviewers.map((r) => setupValue(setupFrom(r, defaultModel)));
		return !!this.defaultPanel && JSON.stringify(panel) === JSON.stringify(this.defaultPanel);
	}

	async end(id: AgentId, action: 'stop' | 'finish') {
		const review = await api.endAgentReview(this.#session.ref, id, action).catch(() => null);
		if (review) this.#collect(id, review);
	}

	async add(): Promise<AgentId> {
		let added: AgentId = FIRST_AGENT;
		await this.#session.update((r) => {
			// Numbers aren't reused, so an agent still submitting to a removed
			// reviewer can't land in a new one.
			const highest = Math.max(0, r.agentHighest ?? 0, ...r.agentReviewers.map((a) => Number(a.id.slice('agent-'.length))));
			added = `agent-${highest + 1}`;
			r.agentHighest = highest + 1;
			r.agentReviewers = [...r.agentReviewers.filter((a) => a.id !== added), { id: added }];
			r.panelSettled = true;
			nameAll(r);
		});
		return added;
	}

	async remove(id: AgentId) {
		if (id === FIRST_AGENT) return;
		this.#removed.add(id);
		delete this.reviews[id];
		api.dismissAgentReview(this.#session.ref, id, true);
		await this.#session.update((r) => {
			r.agentReviewers = r.agentReviewers.filter((a) => a.id !== id);
			delete r.feedback[id];
			r.panelSettled = true;
		});
	}

	// Copies a review's findings into its reviewer's draft as they arrive,
	// keeping any already unticked, and lets the backend forget the review
	// once it's over.
	#collect(id: AgentId, review: AgentReview) {
		if (this.#removed.has(id)) return;
		this.reviews[id] = review;
		const seen = this.#seen[id];
		if (seen?.id !== review.id || seen.count !== review.findings.length) {
			this.#seen[id] = { id: review.id, count: review.findings.length };
			this.#session.update((r) => {
				const included = new Map((r.feedback[id]?.items ?? []).map((i) => [i.id, i.included]));
				const draft: FeedbackDraft = {
					items: review.findings.map((f) => ({
						id: f.id,
						body: f.body,
						rationale: f.rationale,
						included: included.get(f.id) ?? true,
						path: f.path,
						...(f.startLine
							? {
									start: { side: 'new' as const, line: f.startLine },
									end: { side: 'new' as const, line: f.endLine ?? f.startLine }
								}
							: {})
					})),
					draftedAt: Date.now()
				};
				r.feedback[id] = draft;
			});
		}
		// The run itself, kept for after the backend lets it go.
		const lastRun = {
			startedAt: review.startedAt,
			endedAt: review.endedAt,
			status: review.status,
			findings: review.findings.length,
			...(review.error ? { error: review.error } : {})
		};
		const saved = this.reviewers.find((a) => a.id === id)?.lastRun;
		if (JSON.stringify(saved) !== JSON.stringify(lastRun)) {
			this.#session
				.update((r) => {
					r.agentReviewers = r.agentReviewers.map((a) => (a.id === id ? { ...a, lastRun } : a));
				})
				.catch(() => {});
		}
		if (review.status === 'running') this.#startPolling();
		else {
			api.dismissAgentReview(this.#session.ref, id);
			if (!this.running.length) this.#stopPolling();
		}
	}

	#startPolling() {
		if (this.#poll) return;
		this.#poll = setInterval(() => {
			for (const { id } of this.running) {
				api
					.getAgentReview(this.#session.ref, id)
					.then((review) => {
						if (review) this.#collect(id, review);
						else {
							// Reviews only live as long as the backend process.
							const lost = this.reviews[id];
							if (lost) this.reviews[id] = { ...lost, status: 'failed', error: 'The backend restarted, so this review was lost.' };
						}
					})
					.catch(() => {});
			}
			if (!this.running.length) this.#stopPolling();
		}, 2000);
	}

	#stopPolling() {
		if (this.#poll) clearInterval(this.#poll);
		this.#poll = null;
	}
}
