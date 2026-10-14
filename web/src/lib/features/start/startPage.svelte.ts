import { listModels, readOk } from '$lib/api/client';
import { dismissGeneration, listGenerations, stopGeneration } from '$lib/features/preparing/generations';
import { isGenerating, isSliceReviewed } from '$lib/session/session.svelte';
import { deleteSaved, listSaved, normalize, updateRecord } from '$lib/storage/record';
import { ask } from '$lib/ui/confirm.svelte';
import { isUnread, type Generation, type NoteMessage, type PrRecord, type PrRef, type SavedPr } from '$lib/types';
import { beginRound, dropRound, roundView } from '$lib/storage/rounds';
import { dismissAgentReview } from '$lib/features/panel/reviewCalls';
import { coverage } from '$lib/features/rounds/coverage';

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
	// Its latest hundred commits, oldest first.
	commits?: { sha: string; date: string; merge: boolean }[];
}

// A round on a row: where it stands, as a bauble that links to it, and
// what its card says on hover.
export interface RoundBauble {
	n: number;
	label: string;
	tone: Tone;
	// Begun but not prepared yet.
	draft: boolean;
	href: string;
	commits?: number;
	dates?: string;
	progress?: { done: number; total: number };
	findings?: number;
	// Answers to your questions you haven't read yet.
	unread?: number;
	// Findings the panel's editor hasn't checked yet.
	checking?: number;
	// Only the latest round can go, so no other round's link changes.
	deletable: boolean;
}

export interface RowView {
	rounds: RoundBauble[];
	// Commits pushed since the latest round, to review as the next.
	fresh: number;
	// For a PR not opened yet: where it stands on GitHub.
	note?: string;
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

// Whether any part of a round has been prepared.
const begun = (r: Partial<PrRecord>) => !!(r.slices || r.summary || r.conversation || r.fileNotes);

// Only what the rows need is kept, not each review's slices and notes; of
// earlier rounds, only where each stands.
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
			range: r.range,
			rounds: r.rounds?.map((round) => ({
				range: round.range,
				preparedHead: round.preparedHead,
				completedAt: round.completedAt,
				summary: round.summary ? { what: '', why: '' } : null,
				slices: round.slices?.map((sl) => ({ ...sl, title: '', summary: '' })) ?? null,
				reviewed: round.reviewed,
				review: round.review?.posted ? ({ posted: round.review.posted } as PrRecord['review']) : undefined
			})),
			lastOpenedAt: r.lastOpenedAt,
			summary: r.summary ? { what: '', why: '' } : null,
			slices: r.slices?.map((sl) => ({ ...sl, title: '', summary: '' })) ?? null,
			reviewed: r.reviewed,
			review: r.review?.posted ? ({ posted: r.review.posted } as PrRecord['review']) : undefined,
			agentReviewers: r.agentReviewers.map((a) => ({ id: a.id, lastRun: a.lastRun })),
			feedback: Object.fromEntries(
				Object.entries(r.feedback).map(([k, d]) => [
					k,
					d
						? {
								...d,
								items: d.items.map((i) => ({
									id: i.id,
									body: '',
									included: i.included,
									readAt: i.readAt,
									edited: i.edited,
									editFailed: i.editFailed,
									messages: lastAnswer(i.messages)
								}))
							}
						: d
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

	readonly rows = $derived.by((): Row[] => {
		const list: Row[] = [...(this.saved ?? [])];
		for (const i of this.involved) {
			if (list.some((r) => keyOf(r) === keyOf(i))) continue;
			list.push({ owner: i.owner, repo: i.repo, number: i.number, record: { ...normalize({}), title: i.title, author: i.author }, unsaved: true });
		}
		return list;
	});
	readonly notComplete = $derived(this.rows.filter((pr) => !this.isComplete(pr) && !this.isHidden(pr)));
	// PRs the reviewer wrote get a section of their own.
	readonly active = $derived(this.notComplete.filter((pr) => !this.isMine(pr)));
	readonly mine = $derived(this.notComplete.filter((pr) => this.isMine(pr)));
	readonly hiddenRows = $derived(this.rows.filter((pr) => this.isHidden(pr)));
	readonly complete = $derived((this.saved ?? []).filter((pr) => this.isComplete(pr) && !this.isHidden(pr)));
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

	// Reads saved reviews and the backend's runs together.
	async refresh() {
		fetch('/api/agent-reviews')
			.then((res) => readOk<{ reviews: StartPage['agentReviews'] }>(res))
			.then(({ reviews }) => (this.agentReviews = reviews))
			.catch(() => {});
		const listed = await listGenerations().catch(() => []);
		// The backend saves what a run makes; a finished one is let go here.
		for (const { generation, ...ref } of listed) {
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

	reviewState(r: InvolvedPr): string {
		const draft = r.isDraft ? 'Draft · ' : '';
		if (r.decision === 'APPROVED') return `${draft}Approved`;
		if (r.decision === 'CHANGES_REQUESTED') return `${draft}Changes requested`;
		const by = [...new Set(r.reviews.map((v) => v.author).filter(Boolean))];
		if (!by.length) return `${draft}No reviews yet`;
		return `${draft}Reviewed by ${by[0]}${by.length > 1 ? ` +${by.length - 1}` : ''}`;
	}

	// Marked complete, and not since given more to review: commits pushed to
	// a PR still open bring it back.
	isComplete(pr: Row): boolean {
		return !!pr.record.completedAt && !this.rowOf(pr).fresh;
	}

	// A review's rounds, oldest first, each read like a record.
	roundsOf(pr: Row): PrRecord[] {
		return [...(pr.record.rounds ?? []).map((_, i) => roundView(pr.record, i)), pr.record];
	}

	// What a row shows: a bauble per round, each opening its round, and the
	// commits pushed since, to review as the next. A round begun but not
	// prepared is a draft. A complete review, or a closed PR, counts no new
	// commits: it isn't asking for more.
	rowOf(pr: Row): RowView {
		const involved = this.involvedOf(pr);
		if (pr.unsaved) return { rounds: [], fresh: 0, note: involved ? this.reviewState(involved) : undefined };
		const rounds = this.roundsOf(pr);
		const generation = this.generationFor(pr);
		const status = this.statuses[keyOf(pr)];
		const ends = rounds.map((r, i) => {
			const latest = i === rounds.length - 1;
			return { range: r.range, end: begun(r) || (latest && generation) ? (r.preparedHead ?? (latest ? status?.head : undefined)) : undefined };
		});
		const covered = status?.commits ? coverage(status.commits, ends) : null;
		const base = `/pr/${pr.owner}/${pr.repo}/${pr.number}`;
		const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
		const baubles = rounds.map((r, i): RoundBauble => {
			const latest = i === rounds.length - 1;
			const state = this.#stateOfRound(pr, r, latest);
			const span = covered?.spans[i];
			const held = span && status?.commits ? status.commits.filter((c, k) => !c.merge && k > span.from && k <= span.to) : [];
			const slices = r.slices ?? (latest ? generation?.results.slices : undefined) ?? [];
			const findings = latest ? this.panelFor(pr)?.findings : undefined;
			// Earlier rounds aren't kept here in enough detail to tell.
			const unread = latest ? [...Object.values(r.feedback).flatMap((d) => d?.items ?? []), ...r.notes].filter(isUnread).length : 0;
			return {
				n: i + 1,
				label: state.label,
				tone: state.tone,
				draft: rounds.length > 1 && latest && !begun(r) && !generation,
				href: rounds.length > 1 ? `${base}/round-${i + 1}` : base,
				...(held.length ? { commits: held.length, dates: day(held[0].date) === day(held.at(-1)!.date) ? day(held[0].date) : `${day(held[0].date)} – ${day(held.at(-1)!.date)}` } : {}),
				...(slices.length ? { progress: { done: slices.filter((sl) => isSliceReviewed(sl, r.reviewed)).length, total: slices.length } } : {}),
				...(findings ? { findings } : {}),
				...(unread ? { unread } : {}),
				...(latest && this.#checking(pr) ? { checking: this.#checking(pr) } : {}),
				deletable: latest && rounds.length > 1
			};
		});
		const closed = !!status && status.state !== 'OPEN';
		// A closed PR isn't asking for more; an open one is, complete or not.
		const fresh = closed || !rounds.some((r) => begun(r)) ? 0 : (covered?.fresh ?? 0);
		return { rounds: baubles, fresh };
	}

	// Begins the next round from the list, for its commits to be chosen.
	async startRound(pr: Row): Promise<string> {
		const n = this.roundsOf(pr).length + 1;
		await updateRecord(pr, (r) => beginRound(r, null));
		return `/pr/${pr.owner}/${pr.repo}/${pr.number}/round-${n}`;
	}

	// Takes back the latest round, its threads, findings and review with it.
	async deleteRound(pr: Row) {
		const rounds = this.roundsOf(pr);
		const n = rounds.length;
		if (n < 2) return;
		if (!(await ask({ title: `Delete round ${n}?`, body: 'Its threads, findings and review go with it. The commits it covered can go into a new round.', action: 'Delete' }))) return;
		const generation = this.generationFor(pr);
		if (isGenerating(generation)) await stopGeneration(pr).catch(() => {});
		if (generation) await dismissGeneration(pr).catch(() => {});
		for (const { id } of pr.record.agentReviewers) await dismissAgentReview(pr, id, true);
		await updateRecord(pr, dropRound).catch(() => {});
		await this.refresh();
	}

	// Where a round stands, as one of a few states. Preparing and the panel
	// are the latest round's.
	#stateOfRound(pr: Row, r: PrRecord, latest: boolean): { label: string; tone: Tone } {
		if (pr.unsaved) return { label: 'New', tone: 'new' };
		const generation = latest ? this.generationFor(pr) : undefined;
		if (generation?.status === 'queued') return { label: 'Queued', tone: 'quiet' };
		if (isGenerating(generation) && generation?.steps.summary.status !== 'done') return { label: 'Preparing', tone: 'working' };
		if (generation?.status === 'failed') return { label: 'Preparing failed', tone: 'bad' };
		if (generation?.status === 'stopped' && !r.summary) return { label: 'Stopped', tone: 'quiet' };
		if (r.completedAt) return { label: 'Complete', tone: 'done' };
		if (r.review?.posted?.pending) return { label: 'Pending on GitHub', tone: 'going' };
		if (r.review?.posted) return { label: 'Posted', tone: 'done' };
		// The editor checking what the reviewers found is part of reviewing.
		if (latest && (this.panelFor(pr)?.running || this.#checking(pr))) return { label: 'Reviewing', tone: 'working' };
		const slices = r.slices ?? generation?.results.slices ?? [];
		const done = slices.filter((s) => isSliceReviewed(s, r.reviewed)).length;
		if (slices.length && done === slices.length) return { label: 'Read', tone: 'read' };
		if (done > 0) return { label: 'In progress', tone: 'going' };
		if (r.summary || slices.length) return { label: 'Ready', tone: 'ready' };
		return { label: 'Not prepared', tone: 'quiet' };
	}

	// Findings not yet through the panel's editor. The backend saves them
	// into the review as they come, so they're all in the record.
	#checking(pr: SavedPr): number {
		return Object.entries(pr.record.feedback)
			.filter(([key]) => key.startsWith('agent-'))
			.reduce((n, [, d]) => n + (d?.items.filter((i) => !i.edited && !i.editFailed).length ?? 0), 0);
	}

	// Where a PR's panel is: reviewing, or done with its findings in.
	panelFor(pr: SavedPr): { running: number; findings: number } | null {
		const live = this.agentReviews.filter((r) => keyOf(r) === keyOf(pr));
		const running = live.filter((r) => r.status === 'running').length;
		const ran = live.length > 0 || pr.record.agentReviewers.some((a) => a.lastRun);
		if (!ran) return null;
		// Saved into the review as they come, so the record has them all.
		const findings = Object.entries(pr.record.feedback)
			.filter(([key]) => key.startsWith('agent-'))
			.reduce((n, [, d]) => n + (d?.items.length ?? 0), 0);
		return { running, findings };
	}

	generationFor(pr: SavedPr): Generation | undefined {
		return this.generations.find((g) => keyOf(g) === keyOf(pr))?.generation;
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
