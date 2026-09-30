import { listModels, readOk } from '$lib/api/client';
import { dismissGeneration, listGenerations, stopGeneration } from '$lib/features/preparing/generations';
import { isGenerating, isSliceReviewed } from '$lib/session/session.svelte';
import { deleteSaved, listSaved, normalize, updateRecord } from '$lib/storage/record';
import { ask } from '$lib/ui/confirm.svelte';
import { isUnread, type Generation, type NoteMessage, type PrRecord, type PrRef, type SavedPr } from '$lib/types';

// The start page's lists: saved reviews, and open PRs you're part of on
// GitHub, with where each stands. Created once per visit to the page; its
// polling stops when the page goes.

// Open PRs you're part of on GitHub - asked to review, reviewed, or wrote.
export interface InvolvedPr extends PrRef {
	title: string;
	author?: string;
	updatedAt: string;
	createdAt: string;
	isDraft: boolean;
	decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
	reviews: { state: string; author?: string }[];
	mine: boolean;
}

// Where a saved PR stands on GitHub now.
interface PrStatus extends PrRef {
	head: string;
	createdAt: string;
	updatedAt?: string;
	author?: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
}

// A row on the page: a saved review, or a PR you're part of that Docent
// hasn't opened yet.
export type Row = SavedPr & { unsaved?: boolean };

export type Sort = 'none' | 'repo' | 'author';

export type Tone = 'new' | 'working' | 'ready' | 'going' | 'read' | 'done' | 'bad' | 'quiet';

export const keyOf = (ref: PrRef) => `${ref.owner}/${ref.repo}/${ref.number}`;

// The page as it was last time, shown straight away so the lists don't
// reshuffle as each fetch lands; fresh results then update it in place.
const CACHE_KEY = 'docent.landing';

interface Cached {
	saved?: SavedPr[];
	involved?: InvolvedPr[];
	statuses?: Record<string, PrStatus>;
	hidden?: string[];
	login?: string | null;
}

function readCache(): Cached {
	try {
		return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
	} catch {
		return {};
	}
}

// A conversation's latest answer, all that telling whether it's unread needs.
function lastAnswer(messages: NoteMessage[] | undefined): NoteMessage[] | undefined {
	const answer = messages?.findLast((m) => m.role === 'assistant');
	return answer ? [{ ...answer, text: '' }] : undefined;
}

// Only what the rows need is kept, not each review's slices and notes.
function trimmed(pr: SavedPr): SavedPr {
	const r = pr.record;
	return {
		owner: pr.owner,
		repo: pr.repo,
		number: pr.number,
		record: {
			...normalize({}),
			title: r.title,
			author: r.author,
			completedAt: r.completedAt,
			preparedHead: r.preparedHead,
			lastOpenedAt: r.lastOpenedAt,
			summary: r.summary ? { what: '', why: '' } : null,
			slices: r.slices?.map((sl) => ({ ...sl, title: '', summary: '' })) ?? null,
			reviewed: r.reviewed,
			review: r.review?.posted ? ({ posted: r.review.posted } as PrRecord['review']) : undefined,
			agentReviewers: r.agentReviewers.map((a) => ({ id: a.id, lastRun: a.lastRun })),
			feedback: Object.fromEntries(
				Object.entries(r.feedback).map(([k, d]) => [
					k,
					d ? { ...d, items: d.items.map((i) => ({ id: i.id, body: '', included: i.included, readAt: i.readAt, messages: lastAnswer(i.messages) })) } : d
				])
			),
			// Enough of each thread to tell whether its latest reply is unread.
			notes: r.notes.map((n) => ({ ...n, messages: lastAnswer(n.messages) ?? [] }))
		}
	};
}

function readPref<T>(key: string, parse: (raw: string | null) => T): T {
	try {
		return parse(localStorage.getItem(key));
	} catch {
		return parse(null);
	}
}

function writePref(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Remembering it is a nicety.
	}
}

export class StartPage {
	#cached = readCache();
	saved = $state<SavedPr[] | null>(this.#cached.saved ?? null);
	generations = $state<(PrRef & { generation: Generation })[]>([]);
	// Agent reviews running, or finished and not yet collected by the PR.
	agentReviews = $state<(PrRef & { reviewer: string; status: string; findings: number })[]>([]);
	now = $state(Date.now());
	// Refreshed on load and every few minutes. They're always listed; ones not
	// opened in Docent yet read as New.
	involved = $state<InvolvedPr[]>(this.#cached.involved ?? []);
	// Old PRs that can't be closed can be hidden: they leave the lists above
	// for a section of their own. Kept in Docent's settings.
	hiddenKeys = $state<string[]>(this.#cached.hidden ?? []);
	statuses = $state<Record<string, PrStatus>>(this.#cached.statuses ?? {});
	// What Docent needs before it can do anything: the GitHub CLI signed in,
	// and a model to use. Null until checked.
	gh = $state<{ installed: boolean; login?: string } | null>(null);
	// Where the available models come from: "Claude Code", "Codex", a provider.
	modelSources = $state<string[] | null>(null);
	// The reviewer's GitHub login, to tell their own PRs apart.
	login = $state<string | null>(this.#cached.login ?? null);
	// The setup guide shows once, for someone missing what's needed.
	setupSeen = $state(readPref('docent.setupSeen', (v) => v === 'true'));
	// How the lists are grouped, and the groups folded away, kept in this browser.
	sort = $state<Sort>(readPref('docent.sort', (v) => (v === 'repo' || v === 'author' ? v : 'none')));
	collapsed = $state<string[]>(readPref('docent.collapsedGroups', (v) => JSON.parse(v ?? '[]')));

	#statusesAt = 0;
	// Runs whose results are already saved, so each is written once.
	#collected = new Set<string>();

	readonly rows = $derived.by((): Row[] => {
		const list: Row[] = [...(this.saved ?? [])];
		for (const i of this.involved) {
			if (list.some((r) => keyOf(r) === keyOf(i))) continue;
			list.push({ owner: i.owner, repo: i.repo, number: i.number, record: { ...normalize({}), title: i.title, author: i.author }, unsaved: true });
		}
		return list;
	});
	readonly notComplete = $derived(this.rows.filter((pr) => !pr.record.completedAt && !this.isHidden(pr)));
	// PRs the reviewer wrote get a section of their own.
	readonly active = $derived(this.notComplete.filter((pr) => !this.isMine(pr)));
	readonly mine = $derived(this.notComplete.filter((pr) => this.isMine(pr)));
	readonly hiddenRows = $derived(this.rows.filter((pr) => this.isHidden(pr)));
	readonly complete = $derived((this.saved ?? []).filter((pr) => pr.record.completedAt && !this.isHidden(pr)));
	readonly checked = $derived(this.gh !== null && this.modelSources !== null);
	readonly ready = $derived(!!this.gh?.login && !!this.modelSources?.length);
	readonly anyRunning = $derived(
		this.generations.some(({ generation }) => isGenerating(generation)) || this.agentReviews.some((r) => r.status === 'running')
	);

	constructor() {
		$effect(() => {
			const cache = { saved: this.saved?.map(trimmed), involved: this.involved, statuses: this.statuses, hidden: this.hiddenKeys, login: this.login };
			writePref(CACHE_KEY, JSON.stringify(cache));
		});
		$effect(() => {
			this.#loadInvolved();
			const every = setInterval(() => this.#loadInvolved(), 5 * 60_000);
			return () => clearInterval(every);
		});
		$effect(() => {
			fetch('/api/hidden-prs')
				.then((res) => readOk<{ hidden: string[] }>(res))
				.then((r) => (this.hiddenKeys = r.hidden))
				.catch(() => {});
		});
		$effect(() => {
			this.recheck();
		});
		$effect(() => {
			this.refresh();
		});
		$effect(() => {
			const every = setInterval(() => this.saved && this.#loadStatuses(this.saved, true), 5 * 60_000);
			return () => clearInterval(every);
		});
		$effect(() => {
			if (!this.anyRunning) return;
			const poll = setInterval(() => this.refresh(), 2000);
			const tick = setInterval(() => (this.now = Date.now()), 30000);
			return () => {
				clearInterval(poll);
				clearInterval(tick);
			};
		});
	}

	// What's set up on this machine, checked again on asking.
	async recheck() {
		const [setup, models] = await Promise.all([
			fetch('/api/setup')
				.then((res) => readOk<{ gh: { installed: boolean; login?: string } }>(res))
				.catch(() => null),
			listModels().catch(() => null)
		]);
		if (setup) {
			this.gh = setup.gh;
			this.login = setup.gh.login ?? null;
		}
		if (models) this.modelSources = [...new Set(models.options.map((o) => o.source))];
	}

	dismissSetup() {
		this.setupSeen = true;
		writePref('docent.setupSeen', 'true');
	}

	#loadInvolved() {
		fetch('/api/involved-prs')
			.then((res) => readOk<{ prs: InvolvedPr[] }>(res))
			.then((r) => (this.involved = r.prs))
			.catch(() => {});
	}

	// Checked on load and every few minutes.
	#loadStatuses(list: SavedPr[], force = false) {
		if (!list.length || (!force && Date.now() - this.#statusesAt < 5 * 60_000)) return;
		this.#statusesAt = Date.now();
		fetch('/api/pr-statuses', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prs: list.map(({ owner, repo, number }) => ({ owner, repo, number })) })
		})
			.then((res) => readOk<{ statuses: PrStatus[] }>(res))
			.then((r) => (this.statuses = Object.fromEntries(r.statuses.map((st) => [keyOf(st), st]))))
			.catch(() => {});
	}

	// Reads saved reviews and the backend's runs together. A run that ended
	// while nobody was looking gets its results saved here; a finished one is
	// then dropped from the backend.
	async refresh() {
		fetch('/api/agent-reviews')
			.then((res) => readOk<{ reviews: StartPage['agentReviews'] }>(res))
			.then(({ reviews }) => (this.agentReviews = reviews))
			.catch(() => {});
		const listed = await listGenerations().catch(() => []);
		for (const { generation, ...ref } of listed) {
			const mark = `${generation.id}:${generation.status}`;
			if (isGenerating(generation) || this.#collected.has(mark)) continue;
			this.#collected.add(mark);
			const { slices, conversation, summary, fileNotes, head } = generation.results;
			if (slices || conversation || summary || fileNotes) {
				await updateRecord(ref, (r) => {
					if (slices) r.slices = slices;
					if (slices && head) r.preparedHead = head;
					if (conversation) r.conversation = conversation;
					if (summary) r.summary = summary;
					if (fileNotes) r.fileNotes = fileNotes;
				}).catch(() => {});
			}
			if (generation.status === 'done') await dismissGeneration(ref);
		}
		const list = await listSaved().catch(() => [] as SavedPr[]);
		// A run can exist for a PR with nothing saved yet.
		for (const { generation: _, ...ref } of listed) {
			if (!list.some((s) => keyOf(s) === keyOf(ref))) list.push({ ...ref, record: normalize({}) });
		}
		this.saved = list.sort((a, b) => (b.record.lastOpenedAt ?? 0) - (a.record.lastOpenedAt ?? 0));
		this.#loadStatuses(list);
		this.generations = listed.filter(({ generation }) => generation.status !== 'done');
	}

	involvedOf(pr: PrRef) {
		return this.involved.find((i) => keyOf(i) === keyOf(pr));
	}

	isMine(pr: SavedPr) {
		return !!this.involvedOf(pr)?.mine || (!!this.login && this.authorOf(pr) === this.login);
	}

	isHidden(pr: PrRef) {
		return this.hiddenKeys.includes(keyOf(pr));
	}

	async setHidden(pr: PrRef, hidden: boolean) {
		this.hiddenKeys = hidden ? [...this.hiddenKeys, keyOf(pr)] : this.hiddenKeys.filter((k) => k !== keyOf(pr));
		const res = await fetch('/api/hidden-prs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ owner: pr.owner, repo: pr.repo, number: pr.number, hidden })
		}).catch(() => null);
		if (res?.ok) this.hiddenKeys = (await res.json()).hidden;
	}

	setSort(value: Sort) {
		this.sort = value;
		writePref('docent.sort', value);
	}

	toggleGroup(key: string) {
		this.collapsed = this.collapsed.includes(key) ? this.collapsed.filter((k) => k !== key) : [...this.collapsed, key];
		writePref('docent.collapsedGroups', JSON.stringify(this.collapsed));
	}

	// A list in groups: one group by recency, else one per repo or author.
	// Oldest first throughout: the longest-waiting PRs are cleared first.
	grouped(list: Row[]) {
		list = [...list].sort((a, b) => this.raisedAt(a) - this.raisedAt(b));
		if (this.sort === 'none') return [{ label: '', items: list }];
		const labelOf = (pr: Row) => (this.sort === 'repo' ? `${pr.owner}/${pr.repo}` : (this.authorOf(pr) ?? 'Author not known yet'));
		const byLabel = new Map<string, Row[]>();
		for (const pr of list) byLabel.set(labelOf(pr), [...(byLabel.get(labelOf(pr)) ?? []), pr]);
		return [...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({ label, items }));
	}

	authorOf(pr: SavedPr) {
		return pr.record.author ?? this.statuses[keyOf(pr)]?.author ?? this.involvedOf(pr)?.author;
	}

	raisedAt(pr: SavedPr) {
		return Date.parse(this.statuses[keyOf(pr)]?.createdAt ?? this.involvedOf(pr)?.createdAt ?? '') || 0;
	}

	// New commits since the slices were made.
	updatedSince(pr: SavedPr) {
		const head = this.statuses[keyOf(pr)]?.head;
		return !!pr.record.preparedHead && !!head && head !== pr.record.preparedHead;
	}

	reviewState(r: InvolvedPr): string {
		const draft = r.isDraft ? 'Draft · ' : '';
		if (r.decision === 'APPROVED') return `${draft}Approved`;
		if (r.decision === 'CHANGES_REQUESTED') return `${draft}Changes requested`;
		const by = [...new Set(r.reviews.map((v) => v.author).filter(Boolean))];
		if (!by.length) return `${draft}No reviews yet`;
		return `${draft}Reviewed by ${by.slice(0, 2).join(', ')}${by.length > 2 ? ` and ${by.length - 2} more` : ''}`;
	}

	// What's happened since you last opened a PR: activity on GitHub, a
	// reviewer finishing, an answer you haven't read. None for one never opened.
	changesSince(pr: Row): string[] {
		const opened = pr.record.lastOpenedAt;
		if (pr.unsaved || !opened) return [];
		const updated = Date.parse(this.statuses[keyOf(pr)]?.updatedAt ?? this.involvedOf(pr)?.updatedAt ?? '') || 0;
		const finished = pr.record.agentReviewers.filter((a) => (a.lastRun?.endedAt ?? 0) > opened).length;
		const answers = [...Object.values(pr.record.feedback).flatMap((d) => d?.items ?? []), ...pr.record.notes].filter(isUnread).length;
		return [
			updated > opened ? 'new activity on GitHub' : '',
			finished ? `${finished} ${finished === 1 ? 'reviewer' : 'reviewers'} finished` : '',
			answers ? `${answers} unread ${answers === 1 ? 'answer' : 'answers'}` : ''
		].filter(Boolean);
	}

	// Where a review stands, as one of a few states.
	stateOf(pr: Row): { label: string; tone: Tone } {
		if (pr.unsaved) return { label: 'New', tone: 'new' };
		const generation = this.generationFor(pr);
		if (generation?.status === 'queued') return { label: 'Queued', tone: 'quiet' };
		if (isGenerating(generation) && generation?.steps.summary.status !== 'done') return { label: 'Preparing', tone: 'working' };
		if (generation?.status === 'failed') return { label: 'Preparing failed', tone: 'bad' };
		if (generation?.status === 'stopped' && !pr.record.summary) return { label: 'Stopped', tone: 'quiet' };
		if (pr.record.completedAt) return { label: 'Complete', tone: 'done' };
		if (pr.record.review?.posted?.pending) return { label: 'Pending on GitHub', tone: 'going' };
		if (pr.record.review?.posted) return { label: 'Posted', tone: 'done' };
		if (this.panelFor(pr)?.running) return { label: 'Reviewing', tone: 'working' };
		const { done, total } = this.progress(pr);
		if (total && done === total) return { label: 'Read', tone: 'read' };
		if (done > 0) return { label: 'In progress', tone: 'going' };
		if (pr.record.summary || total) return { label: 'Ready', tone: 'ready' };
		return { label: 'Not prepared', tone: 'quiet' };
	}

	// Where a PR's panel is: reviewing, or done with its findings in.
	panelFor(pr: SavedPr): { running: number; findings: number } | null {
		const live = this.agentReviews.filter((r) => keyOf(r) === keyOf(pr));
		const running = live.filter((r) => r.status === 'running').length;
		const ran = live.length > 0 || pr.record.agentReviewers.some((a) => a.lastRun);
		if (!ran) return null;
		const collected = Object.entries(pr.record.feedback)
			.filter(([key]) => key.startsWith('agent-') && !live.some((r) => r.reviewer === key))
			.reduce((n, [, d]) => n + (d?.items.length ?? 0), 0);
		return { running, findings: collected + live.reduce((n, r) => n + r.findings, 0) };
	}

	generationFor(pr: SavedPr): Generation | undefined {
		return this.generations.find((g) => keyOf(g) === keyOf(pr))?.generation;
	}

	// A run still going can already have its slices; they count as soon as
	// they exist.
	progress(pr: SavedPr) {
		const slices = pr.record.slices ?? this.generationFor(pr)?.results.slices ?? [];
		const done = slices.filter((s) => isSliceReviewed(s, pr.record.reviewed)).length;
		return { done, total: slices.length };
	}

	async remove(pr: SavedPr) {
		const title = pr.record.title ?? `#${pr.number}`;
		if (!(await ask({ title: `Delete your review of “${title}”?`, body: 'Its threads and feedback go with it.', action: 'Delete' }))) return;
		const generation = this.generationFor(pr);
		if (isGenerating(generation)) await stopGeneration(pr).catch(() => {});
		await dismissGeneration(pr);
		await deleteSaved(pr);
		await this.refresh();
	}
}
