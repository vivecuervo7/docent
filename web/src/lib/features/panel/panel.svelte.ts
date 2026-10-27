import { readOk, sendJson, prUrl } from '../../api/client';
import { dismissAgentReview, endAgentReview, getAgentReview, getDefaultPanel, setDefaultPanel } from './reviewCalls';
import { known, reviewerLabel } from './reviewers.svelte';
import {
	AUTO_PERSONA,
	entryOf,
	isAuto,
	isDocents,
	nameAll,
	reviewerFrom,
	sessionId,
	setupFrom,
	setupOfValue,
	setupValue,
	type ExternalReviewer,
	type PanelEntry,
	type Persona,
	type ReviewerSetup
} from './setup';
export { AUTO_PERSONA, isAuto, modelLabel, nameAll, reviewerFrom, sessionId, setupFrom, setupValue } from './setup';
export type { ExternalReviewer, PanelEntry, Persona, ReviewerSetup } from './setup';
import type { PrSession } from '../../session/session.svelte';
import { FIRST_AGENT, type AgentId, type AgentReview, type AgentReviewer, type FeedbackDraft, type FeedbackItem } from '../../types';

// The PR's review panel: its agent reviewers (saved in the record), the
// review each is running, and copying their findings into the record as
// they arrive.

// A reviewer's name as shown, among the panel's reviewers.
export const nameOf = (reviewer: AgentReviewer, reviewers: AgentReviewer[]) => reviewerLabel(reviewers, reviewer.id);

// What to tell the reviewer's own agent after its review, to send the
// findings here. It names the reviewer, so two agents can't be mixed up.
export function agentInstruction(session: PrSession, reviewer: AgentReviewer): string {
	const { owner, repo, number } = session.ref;
	const round = session.round === null ? '' : `@round${session.round + 1}`;
	return `Send these review findings to Docent for ${owner}/${repo}#${number}${round} as ${reviewer.name ?? reviewer.id}.`;
}

export class Panel {
	#session: PrSession;
	reviews = $state<Partial<Record<AgentId, AgentReview>>>({});
	errors = $state<Partial<Record<AgentId, string>>>({});
	// The lookup of the code around the PR its reviewers start from.
	lookup = $state<{ status: 'running' | 'done' | 'failed'; steps: string[]; facts: { fact: string; where: string }[] } | null>(null);
	defaultPanel = $state<PanelEntry[] | null>(null);
	// Kept where reviewers' names can find them.
	get personas(): Persona[] {
		return known.personas as Persona[];
	}
	set personas(value: Persona[]) {
		known.personas = value;
	}
	get externals(): ExternalReviewer[] {
		return known.externals as ExternalReviewer[];
	}
	set externals(value: ExternalReviewer[]) {
		known.externals = value;
	}

	readonly reviewers = $derived.by(() => this.#session.record.agentReviewers);
	// "auto" reviewers choosing their personas, as the review says.
	readonly picking = $derived(Object.fromEntries(this.reviewers.map((a) => [a.id, !!a.picking])) as Partial<Record<AgentId, boolean>>);
	readonly running = $derived.by(() => this.reviewers.filter((r) => this.reviews[r.id]?.status === 'running'));
	readonly findingCount = $derived.by(() => this.reviewers.reduce((n, r) => n + (this.#session.record.feedback[r.id]?.items.length ?? 0), 0));
	// Findings the editor hasn't been through yet: the panel's still
	// reviewing until it has, and they show only once it has.
	readonly checking = $derived.by(() =>
		this.reviewers.reduce((n, r) => n + (this.#session.record.feedback[r.id]?.items.filter((i) => !i.edited && !i.editFailed).length ?? 0), 0)
	);

	// Each review as last read from the record, so a change is read once.
	#seen: Partial<Record<AgentId, { id: string; count: number; status: string }>> = {};
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
			.then((res) => readOk<{ items: Persona[] }>(res))
			.then((r) => (this.personas = r.items))
			.catch(() => {});
		fetch('/api/external-reviewers')
			.then((res) => readOk<{ items: ExternalReviewer[] }>(res))
			.then((r) => (this.externals = r.items))
			.catch(() => {});
		this.defaultPanel = await getDefaultPanel().catch(() => null);
		if (this.reviewers.some((r) => !r.name)) this.#session.update(nameAll).catch(() => {});
		await Promise.all(
			this.reviewers.map(async ({ id }) => {
				const review = await getAgentReview(this.#session.ref, id).catch(() => null);
				if (review) this.#collect(id, review);
			})
		);
		if (this.checking) this.#startPolling();
		this.#checkLookup();
	}

	close() {
		this.#stopPolling();
	}

	// For a new round: lets the backend forget the last round's reviews, and
	// forgets them here, so none of their findings land in the new one.
	reset() {
		this.#stopPolling();
		for (const { id } of this.reviewers) dismissAgentReview(this.#session.ref, id, true);
		this.reviews = {};
		this.errors = {};
		this.lookup = null;
		this.#seen = {};
		this.#removed = new Set();
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
		const saved = await getDefaultPanel().catch(() => null);
		this.defaultPanel = saved;
		await this.#session
			.update((r) => {
				if (!this.#untouched(r)) return;
				r.panelSettled = true;
				// An empty default is a choice too: no reviewers.
				// Ids carry on from the PR's earlier rounds, never reused.
				const highest = r.agentHighest ?? 0;
				if (saved) r.agentReviewers = saved.map((entry, i) => reviewerFrom(entry, `agent-${highest + i + 1}`));
				r.agentHighest = Math.max(highest, ...r.agentReviewers.map((a) => Number(a.id.slice('agent-'.length)) || 0));
				nameAll(r);
			})
			.catch(() => {});
	}

	// The default can replace a panel none of whose reviewers has run yet.
	canUseDefault(defaultModel: string): boolean {
		return (
			!!this.defaultPanel &&
			!this.isDefault(defaultModel) &&
			this.reviewers.every((a) => !a.ranWith && !a.lastRun && !this.findings(a.id) && !this.reviews[a.id])
		);
	}

	async useDefault() {
		const saved = this.defaultPanel;
		if (!saved) return;
		await this.#session.update((r) => {
			const highest = Math.max(0, r.agentHighest ?? 0, ...r.agentReviewers.map((a) => Number(a.id.slice('agent-'.length))));
			// Fresh numbers, never reused, so a removed reviewer's late findings
			// can't land on a new one.
			r.agentReviewers = saved.map((entry, i) => reviewerFrom(entry, `agent-${highest + i + 1}`));
			r.agentHighest = highest + saved.length;
			r.panelSettled = true;
			nameAll(r);
		});
	}

	findings(id: AgentId): number {
		return this.#session.record.feedback[id]?.items.length ?? 0;
	}

	// Starts a reviewer on the backend, which saves its review - and "auto"'s
	// picks - into the review as they come; the page follows from there.
	async start(id: AgentId, setup: ReviewerSetup) {
		const session = this.#session;
		this.errors[id] = undefined;
		try {
			const res = await sendJson(`${prUrl(session.ref)}/panel/start?reviewer=${encodeURIComponent(id)}`, {
				setup,
				...(session.round !== null ? { round: session.round } : {})
			});
			await readOk(res);
			delete this.#seen[id];
			delete this.reviews[id];
			await session.reload();
			session.watch();
		} catch (err) {
			this.errors[id] = (err as Error).message;
		}
	}

	// Follows reviews the backend started that the page isn't yet: ones it
	// started for "auto", or before the page opened.
	track() {
		for (const a of this.reviewers) {
			if (this.#removed.has(a.id) || this.reviews[a.id]?.status === 'running') continue;
			if (!a.ranWith || (a.lastRun && a.lastRun.status !== 'running')) continue;
			getAgentReview(this.#session.ref, a.id)
				.then((review) => review && this.#collect(a.id, review))
				.catch(() => {});
		}
	}

	// Switches a reviewer that hasn't run off or on, remembered with the PR.
	setOff(id: AgentId, off: boolean) {
		this.#session
			.update((r) => {
				r.agentReviewers = r.agentReviewers.map((a) => (a.id === id ? { ...a, off: off || undefined } : a));
			})
			.catch(() => {});
	}

	// What a reviewer runs with next, and for Docent's reviewer its persona.
	plan(id: AgentId, setup: ReviewerSetup) {
		const planned = setupValue(setup);
		const persona = setup.mode === 'builtin' ? setup.persona : undefined;
		this.#session
			.update((r) => {
				r.agentReviewers = r.agentReviewers.map((a) => (a.id === id ? { ...a, planned, persona } : a));
				r.panelSettled = true;
			})
			.catch(() => {});
	}

	// This PR's panel, as what every new PR starts with.
	// "auto" picks personas the PR warrants, leaving out any already on the
	// panel by choice, and runs them in place of its last picks. The general
	// reviewer always goes in with them, unless one is on the panel by choice
	// already.

	// A general reviewer - Docent's, without a persona - on the panel by choice.
	get hasGeneral() {
		return this.reviewers.some((a) => !a.pickedBy && isDocents(a) && !a.persona && !isAuto(a));
	}

	// The panel as chosen, without what "auto" added.
	#chosen() {
		return this.reviewers.filter((r) => !r.pickedBy);
	}

	async saveAsDefault(defaultModel: string) {
		const panel = this.#chosen().map((r) => entryOf(setupFrom(r, defaultModel), r.off));
		this.defaultPanel = await setDefaultPanel(panel);
	}

	isDefault(defaultModel: string): boolean {
		const panel = this.#chosen().map((r) => entryOf(setupFrom(r, defaultModel), r.off));
		const saved = this.defaultPanel?.map((e) => entryOf(setupOfValue(e.runs, e.persona, defaultModel), e.off));
		return !!saved && JSON.stringify(panel) === JSON.stringify(saved);
	}

	personaName(id: string | undefined): string {
		if (id === AUTO_PERSONA) return 'Auto';
		return (id && this.personas.find((p) => p.id === id)?.name) || 'general';
	}

	externalName(value: string | undefined): string | null {
		const id = sessionId(value);
		return id ? (this.externals.find((e) => e.id === id)?.name ?? 'removed') : null;
	}

	async end(id: AgentId, action: 'stop' | 'finish') {
		const review = await endAgentReview(this.#session.ref, id, action).catch(() => null);
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

	// Removing "auto" removes what it picked too.
	async remove(id: AgentId) {
		const gone = [id, ...this.reviewers.filter((a) => a.pickedBy === id).map((a) => a.id)];
		for (const g of gone) {
			this.#removed.add(g);
			delete this.reviews[g];
			dismissAgentReview(this.#session.ref, g, true);
		}
		await this.#session.update((r) => {
			r.agentReviewers = r.agentReviewers.filter((a) => !gone.includes(a.id));
			for (const g of gone) delete r.feedback[g];
			r.panelSettled = true;
		});
	}

	// Copies a review's findings into its reviewer's draft as they arrive,
	// keeping any already unticked, and lets the backend forget the review
	// once it's over.
	#collect(id: AgentId, review: AgentReview) {
		if (this.#removed.has(id)) return;
		this.reviews[id] = review;
		// The backend saves its findings and how it went into the review, and
		// has the editor go through them; the page reads them from there.
		const seen = this.#seen[id];
		if (seen?.id !== review.id || seen.count !== review.findings.length || seen.status !== review.status) {
			this.#seen[id] = { id: review.id, count: review.findings.length, status: review.status };
			this.#session.reload().catch(() => {});
		}
		if (review.status === 'running') this.#startPolling();
		else {
			dismissAgentReview(this.#session.ref, id);
			if (this.checking) this.#startPolling();
			else if (!this.running.length) this.#stopPolling();
		}
	}

	// Whether a reviewer is Docent's own, whose findings the editor may filter;
	// an external reviewer or the reviewer's own agent sifted theirs already.
	#isDocents(id: AgentId): boolean {
		const ranWith = this.reviewers.find((a) => a.id === id)?.ranWith;
		return !!ranWith && ranWith !== 'external' && !sessionId(ranWith);
	}

	// The slices each of Docent's reviewers still running has finished.
	#finishedByRunning(): Set<string>[] {
		return this.reviewers
			.filter((a) => this.reviews[a.id]?.status === 'running' && this.#isDocents(a.id))
			.map((a) => new Set(this.reviews[a.id]?.progress?.finished ?? []));
	}

	// The slices a finding is in: the one it was found in, else where its
	// lines are.
	#slicesOf(item: FeedbackItem): string[] {
		if (item.slice) return [item.slice];
		return item.path ? this.#session.slicesOf(item.path, item.start) : [];
	}

	// Findings the editor hasn't been through yet, and the slices they're in.
	#waiting() {
		return Object.entries(this.#session.record.feedback)
			.filter(([key]) => key.startsWith('agent-'))
			.flatMap(([, draft]) => (draft?.items ?? []).filter((item) => !item.edited && !item.editFailed).map((item) => ({ slices: this.#slicesOf(item) })));
	}

	// Whether the panel is still at work on a slice, so its findings aren't
	// all shown yet.
	reviewing(sliceId: string): boolean {
		return this.#finishedByRunning().some((finished) => !finished.has(sliceId)) || this.#waiting().some((w) => w.slices.includes(sliceId));
	}

	// Findings on a slice the editor filtered out.
	filteredIn(sliceId: string) {
		return Object.entries(this.#session.record.feedback)
			.filter(([key]) => key.startsWith('agent-'))
			.flatMap(([reviewer, draft]) =>
				(draft?.items ?? []).filter((item) => item.filtered && this.#slicesOf(item).includes(sliceId)).map((item) => ({ reviewer, item }))
			);
	}

	#checkLookup() {
		const round = this.#session.round;
		fetch(`${prUrl(this.#session.ref)}/code-context${round === null ? '' : `?round=${round}`}`)
			.then((res) => readOk<{ lookup: Panel['lookup'] }>(res))
			.then((r) => (this.lookup = r.lookup))
			.catch(() => {});
	}

	#startPolling() {
		if (this.#poll) return;
		this.#poll = setInterval(() => {
			this.#checkLookup();
			for (const { id } of this.running) {
				getAgentReview(this.#session.ref, id)
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
			// The editor's results land in the review as it goes.
			if (this.checking) this.#session.reload().catch(() => {});
			if (!this.running.length && !this.checking) this.#stopPolling();
		}, 2000);
	}

	#stopPolling() {
		if (this.#poll) clearInterval(this.#poll);
		this.#poll = null;
	}
}
