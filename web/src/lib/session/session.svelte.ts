import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { fetchCommits, fetchPr, listModels, readOk, prUrl } from '../api/client';
import { dismissGeneration, getGeneration, startGeneration, stopGeneration } from '../features/preparing/generations';
import { type LooseMark, type Mark, looseMarksFrom, marksFrom } from '../features/reading/marks';
import { nearestHunk, parseFilePatch, type Hunk } from '../features/reading/diff/parse';
import { Panel } from '../features/panel/panel.svelte';
import { ReviewPost } from '../features/posting/post.svelte';
import { Conversations } from './conversations.svelte';
import { YourComments } from './yourComments.svelte';
import { everythingElse, isSliceReviewed, reviewKeys } from '../features/reading/progress';
import { readChoice, readPref, writeChoice, writePref } from '../ui/prefs';
import { emptyRecord, getRecord, updateRecord } from '../storage/record';
import { beginRound, dropRound, keepRound, roundView } from '../storage/rounds';
import {
	isUnread,
	type FeedbackItem,
	type Generation,
	type GitHubComments,
	type GitHubThread,
	type PrCommit,
	type LineRef,
	type Note,
	type NoteMessage,
	type PrFile,
	type PrMeta,
	type PrRecord,
	type PrRef,
	type ReviewRange,
	type StepName
} from '../types';

// The open PR: its files, its saved review, and preparing it when parts of
// the review are missing. One per PR, shared with every page under it.

export const GITHUB_IN_DIFF = ['hidden', 'open', 'all'] as const;
export type GitHubInDiff = (typeof GITHUB_IN_DIFF)[number];

export function isGenerating(generation: Generation | null | undefined): boolean {
	return generation?.status === 'queued' || generation?.status === 'running';
}

export { isSliceReviewed };

// Line numbers as ranges: "3-5, 9".
export function lineRanges(lines: number[]): string {
	const sorted = [...new Set(lines)].sort((a, b) => a - b);
	const ranges: string[] = [];
	for (let i = 0; i < sorted.length; i++) {
		let j = i;
		while (sorted[j + 1] === sorted[j] + 1) j++;
		ranges.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
		i = j;
	}
	return ranges.join(', ');
}

// Whether any part of a PR has been prepared.
const begun = (r: PrRecord) => !!(r.slices || r.conversation || r.summary || r.fileNotes);

export class PrSession {
	readonly ref: PrRef;
	files = $state<PrFile[]>([]);
	meta = $state<PrMeta | null>(null);
	// The round of the review being looked at: the latest, unless an earlier
	// one is opened.
	record = $state<PrRecord>(emptyRecord());
	// The whole record, every round in it.
	#stored = $state.raw<PrRecord>(emptyRecord());
	// An earlier round being looked at, by index; null for the latest. Any
	// round can be read, changed, reviewed and posted; what's changed in it
	// is kept in it.
	round = $state<number | null>(null);
	// What's been said on the PR on GitHub, fetched as it opens.
	github = $state<GitHubComments | null>(null);
	// The PR's commits, oldest first, merges included.
	commits = $state<PrCommit[] | null>(null);
	generation = $state<Generation | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);

	// The first preparation of a PR takes over the Overview; a rerun of one
	// that already has a summary happens quietly behind it.
	readonly preparing = $derived(!this.record.summary && this.generation !== null);
	// Nothing's been prepared, or asked for: it waits for the commits to
	// review to be chosen.
	readonly unprepared = $derived(!begun(this.record) && this.generation === null);
	// Viewing preferences, kept in this browser.
	hideWhitespace = $state(readPref('docent.hideWhitespace', true));
	foldTests = $state(readPref('docent.foldTests', true));
	// A round of some commits shown as the PR sees it, against the base
	// branch, or as its commits made it, rework included.
	commitView = $state(readPref('docent.commitView', false));
	// GitHub threads beside the code while reading. They're gone through on
	// the Overview, so reading shows none unless asked.
	githubInDiff = $state(readChoice('docent.githubInDiff', 'hidden', GITHUB_IN_DIFF));

	// Each file's hunks, parsed once.
	readonly hunks = $derived(new Map<string, Hunk[]>(this.files.map((f) => [f.filename, parseFilePatch(f.patch ?? '')])));
	// The hunks under review: for a range of commits, those it touched.
	readonly hunkKeys = $derived(reviewKeys(this.files, (f) => this.hunks.get(f.filename) ?? []));
	// The prepared slices, then anything they left out.
	readonly slices = $derived.by(() => {
		const prepared = this.record.slices ?? [];
		const rest = prepared.length ? everythingElse(this.hunkKeys, prepared) : null;
		return rest ? [...prepared, rest] : prepared;
	});
	readonly reviewed = $derived(this.record.reviewed);
	readonly reviewedSlices = $derived(this.slices.filter((s) => isSliceReviewed(s, this.reviewed)).length);
	readonly title = $derived.by(() => this.meta?.title ?? this.record.title ?? `#${this.ref.number}`);

	readonly roundCount = $derived((this.#stored.rounds?.length ?? 0) + 1);
	// Where a round's pages are. Once a PR has rounds, each is linked by its
	// number, so a link keeps to its round after another begins; a URL
	// without one is the latest.
	baseFor(index: number | null): string {
		const { owner, repo, number } = this.ref;
		const n = index === null ? (this.roundCount > 1 ? this.roundCount : null) : index + 1;
		return `/pr/${owner}/${repo}/${number}${n === null ? '' : `/round-${n}`}`;
	}
	readonly base = $derived(this.baseFor(this.round));
	// The round the URL asks for, by number from 1; the latest when it's
	// none, or the latest's own number.
	#wanted: number | null = null;
	// Every round, oldest first, with the commits each covers; the latest
	// covers none until it's begun.
	readonly roundSpans = $derived(
		[...(this.#stored.rounds ?? []), this.#stored].map((r, i, all) => {
			const latest = i === all.length - 1;
			return {
				index: latest ? null : i,
				range: r.range,
				end: latest && !begun(r as PrRecord) ? undefined : (r.range?.to ?? r.preparedHead ?? this.meta?.head)
			};
		})
	);
	// The commit the round being looked at reads up to.
	readonly roundEnd = $derived(this.record.range?.to ?? this.record.preparedHead ?? this.meta?.head);

	// What's been said on GitHub about the round being looked at: on its
	// files, and by its last commit. One on lines sits on them in a round read
	// at the PR's head, where GitHub places it, or at the commit it was left
	// on; otherwise its lines may have moved, so it sits on its file.
	readonly githubShown = $derived.by((): GitHubComments | null => {
		if (!this.github) return null;
		const files = new Set(this.files.map((f) => f.filename));
		const atHead = !this.roundEnd || this.roundEnd === this.meta?.head;
		const all = this.commits ?? [];
		const endAt = all.findIndex((c) => c.sha === this.roundEnd);
		const endDate = endAt >= 0 ? Date.parse(all[endAt].date) : Infinity;
		const leftBy = (createdAt: string, commit?: string) => {
			if (atHead) return true;
			const at = commit ? all.findIndex((c) => c.sha === commit) : -1;
			return at >= 0 && endAt >= 0 ? at <= endAt : Date.parse(createdAt) <= endDate;
		};
		return {
			threads: this.github.threads
				.filter((t) => files.has(t.path) && leftBy(t.entries[0]?.createdAt ?? '', t.commit))
				.map((t): GitHubThread => {
					if (atHead || (!t.start && !t.outdated)) return t;
					if (t.commit === this.roundEnd && t.originalLine) {
						const side = t.end?.side ?? 'new';
						return { ...t, outdated: false, start: { side, line: t.originalStartLine ?? t.originalLine }, end: { side, line: t.originalLine } };
					}
					return { ...t, start: undefined, end: undefined, outdated: true };
				}),
			general: this.github.general.filter((c) => leftBy(c.createdAt))
		};
	});
	// What of that sits beside the code while reading.
	readonly githubInReading = $derived.by((): GitHubComments | null => {
		const shown = this.githubShown;
		if (!shown || this.githubInDiff === 'hidden') return null;
		return this.githubInDiff === 'all' ? shown : { ...shown, threads: shown.threads.filter((t) => !t.resolved) };
	});
	// The commit the round before the latest read up to.
	readonly previousHead = $derived(this.#stored.rounds?.at(-1)?.range?.to ?? this.#stored.rounds?.at(-1)?.preparedHead);

	readonly panel: Panel = new Panel(this);
	readonly conversations: Conversations = new Conversations(this);
	readonly yours: YourComments = new YourComments(this);
	readonly post: ReviewPost = new ReviewPost(this);

	#collected: { id: string; steps: Set<StepName> } | null = null;
	#poll: ReturnType<typeof setInterval> | null = null;
	#closed = false;

	constructor(ref: PrRef) {
		this.ref = ref;
	}

	async open() {
		try {
			const [pr, { record }, existing] = await Promise.all([fetchPr(this.ref), getRecord(this.ref), getGeneration(this.ref).catch(() => null)]);
			if (this.#closed) return;
			this.files = pr.files;
			this.meta = pr.meta;
			this.#show(record);
			// Answers still being made, from before a refresh.
			this.watch();
			const wanted = this.#roundIndex(this.#wanted);
			if (wanted !== null) await this.viewRound(wanted);
			this.panel.load();
			// A review asked for while it was preparing, which finished while away.
			if (record.summary) this.panel.applyDefault();
			fetchCommits(this.ref)
				.then((commits) => !this.#closed && (this.commits = commits))
				.catch(() => {});
			fetch(`${prUrl(this.ref)}/github-comments`)
				.then((res) => readOk<GitHubComments>(res))
				.then((comments) => !this.#closed && (this.github = comments))
				.catch(() => {});
			this.update((r) => {
				if (pr.meta?.title) r.title = pr.meta.title;
				if (pr.meta?.author) r.author = pr.meta.author;
				r.lastOpenedAt = Date.now();
			}).catch(() => {});

			if (existing) {
				// Picks up what an earlier visit's run finished meanwhile. A stopped
				// or failed run stays that way until it's resumed.
				this.#collect(existing);
			} else if (begun(record) && (!record.slices || !record.conversation || !record.summary || !record.fileNotes)) {
				this.prepare();
			}
		} catch (err) {
			this.error = (err as Error).message;
		} finally {
			this.loading = false;
		}
	}

	close() {
		this.#closed = true;
		this.#stopPolling();
		this.panel.close();
	}

	setHideWhitespace(value: boolean) {
		this.hideWhitespace = value;
		writePref('docent.hideWhitespace', value);
	}

	setFoldTests(value: boolean) {
		this.foldTests = value;
		writePref('docent.foldTests', value);
	}

	setCommitView(value: boolean) {
		this.commitView = value;
		writePref('docent.commitView', value);
	}

	setGitHubInDiff(value: GitHubInDiff) {
		this.githubInDiff = value;
		writeChoice('docent.githubInDiff', value);
	}

	// Ticks or unticks hunks, by key (`path#index`).
	setReviewed(keys: string[], value: boolean) {
		return this.update((r) => {
			for (const key of keys) r.reviewed[key] = value;
		});
	}

	// What's been said on GitHub again, after changing it.
	async refreshGitHub() {
		const comments = await readOk<GitHubComments>(await fetch(`${prUrl(this.ref)}/github-comments`));
		if (!this.#closed) this.github = comments;
	}

	changeFinding(reviewer: string, id: string, change: (item: FeedbackItem) => FeedbackItem) {
		return this.update((r) => {
			const draft = r.feedback[reviewer];
			if (draft) r.feedback[reviewer] = { ...draft, items: draft.items.map((i) => (i.id === id ? change(i) : i)) };
		});
	}

	// Keeps or skips an agent's finding for the review.
	// A decision on a finding holds for its whole group: the lead and every
	// finding that joined it.
	setFindingIncluded(reviewer: string, id: string, included: boolean) {
		this.update((r) => {
			const item = r.feedback[reviewer]?.items.find((i) => i.id === id);
			const lead = item?.joins ?? { reviewer, id };
			const inGroup = (key: string, i: FeedbackItem) =>
				(key === lead.reviewer && i.id === lead.id) || (i.joins?.reviewer === lead.reviewer && i.joins.id === lead.id);
			for (const [key, draft] of Object.entries(r.feedback)) {
				if (!key.startsWith('agent-') || !draft) continue;
				if (draft.items.some((i) => inGroup(key, i))) {
					r.feedback[key] = { ...draft, items: draft.items.map((i) => (inGroup(key, i) ? { ...i, included, decided: true } : i)) };
				}
			}
		}).catch(() => {});
	}

	// A finding that turned out to be a point of its own leaves its group,
	// remembering which, to go back.
	splitFinding(reviewer: string, id: string) {
		this.changeFinding(reviewer, id, ({ joins, ...rest }) => (joins ? { ...rest, separatedFrom: joins } : rest)).catch(() => {});
	}

	// A separated finding back in its group, under whatever now leads it.
	mergeBack(reviewer: string, id: string) {
		const from = this.record.feedback[reviewer]?.items.find((i) => i.id === id)?.separatedFrom;
		const lead = from && this.record.feedback[from.reviewer]?.items.find((i) => i.id === from.id);
		if (!from || !lead) return;
		const joins = lead.joins ?? from;
		this.changeFinding(reviewer, id, ({ separatedFrom: _, ...rest }) => ({ ...rest, joins })).catch(() => {});
	}

	// A finding the editor filtered out, shown after all.
	keepFiltered(reviewer: string, id: string) {
		this.changeFinding(reviewer, id, ({ filtered: _, ...rest }) => rest).catch(() => {});
	}

	// Every agent finding on a file, with the slices its lines are in: the
	// slice holding its first line, or every slice with its file when it's
	// about the whole file. One about the whole PR is in none.
	readonly findings = $derived.by(() =>
		marksFrom(this.record)
			.filter((m) => m.kind === 'finding')
			.map((mark) => ({ mark, slices: this.slicesOf(mark.path, mark.start) }))
	);

	// Findings with no lines: about a whole file, in every slice with that
	// file, or about the whole PR, in none.
	readonly looseFindings = $derived.by(() =>
		looseMarksFrom(this.record).map((mark) => ({ mark, slices: mark.path ? this.slicesOf(mark.path, undefined) : [] }))
	);
	// The findings the editor filtered out, shown faintly where they were raised.
	readonly filteredLoose = $derived(looseMarksFrom(this.record, true).filter((m) => m.filtered));
	// Every finding shown, with lines or without, and the slices it's in.
	readonly allFindings = $derived<{ mark: Mark | LooseMark; slices: string[] }[]>([...this.findings, ...this.looseFindings]);

	slicesOf(path: string, start: LineRef | undefined): string[] {
		const hunks = this.hunks.get(path) ?? [];
		const nearest = start && nearestHunk(hunks, start);
		const keys = start ? (nearest ? [`${path}#${nearest.index}`] : []) : hunks.map((h) => `${path}#${h.index}`);
		return this.slices.filter((s) => s.hunks.some((k) => keys.includes(k))).map((s) => s.id);
	}

	// What's on a slice still to read: findings never opened or decided, and
	// answers not yet seen, on findings or your own threads.
	unreadIn(sliceId: string): number {
		const findings = this.allFindings.filter((f) => f.mark.unread && f.slices.includes(sliceId)).length;
		const threads = this.record.notes.filter((n) => isUnread(n) && (n.slice === sliceId || this.slicesOf(n.path, n.start).includes(sliceId))).length;
		return findings + threads;
	}

	// Findings on a slice still waiting on a keep or skip.
	undecidedIn(sliceId: string) {
		return this.allFindings.filter((f) => !f.mark.decided && f.slices.includes(sliceId)).map((f) => f.mark);
	}

	// A thread or finding to bring into view and open: its file opens, and so
	// does any fold hiding it. Cleared by the file that shows it.
	revealing = $state<string | null>(null);
	// The thread or finding whose bubble is open: one across the page, so
	// opening another, in any file, closes it.
	openMark = $state<string | null>(null);

	// Long line excerpts opened out in full, kept here so going to the diff
	// and back finds them as they were left.
	readonly openExcerpts = new SvelteSet<string>();

	// Saves a change to the review, and shows the record as saved.
	async update(change: (record: PrRecord) => void): Promise<void> {
		const round = this.round;
		change(this.record);
		const saved = await updateRecord(
			this.ref,
			round === null
				? change
				: (full) => {
						const view = roundView(full, round);
						change(view);
						keepRound(full, view, round);
					}
		);
		if (!this.#closed) this.#show(saved);
	}

	// Reads the review while the backend's making something for it - an
	// answer, a draft, a prepared review - until nothing is.
	#watching: ReturnType<typeof setInterval> | null = null;
	watch() {
		this.#applyJobs();
		if (this.#watching) return;
		this.#watching = setInterval(() => {
			const r = this.record;
			const awaited = [...r.notes, ...Object.values(r.feedback).flatMap((d) => d?.items ?? [])].some((x) => x.awaiting);
			const working = Object.values(r.jobs ?? {}).some((job) => job?.status === 'running') || r.agentReviewers.some((a) => a.picking);
			if ((!awaited && !working) || this.#closed) {
				clearInterval(this.#watching!);
				this.#watching = null;
				return;
			}
			this.reload().catch(() => {});
		}, 2000);
	}

	// The review as the backend has it now, for what it saved itself.
	async reload() {
		const { record } = await getRecord(this.ref);
		if (this.#closed) return;
		this.#show(record);
		this.#applyJobs();
		this.panel.track();
	}

	// Makes the round's own what the backend finished while it looked, or
	// while nobody did.
	#applyJobs() {
		const jobs = this.record.jobs;
		if (jobs?.draft?.status === 'done') this.yours.applyDraft(jobs.draft).catch(() => {});
		if (jobs?.prepare?.status === 'done') this.post.applyPrepared(jobs.prepare).catch(() => {});
	}

	#show(record: PrRecord) {
		this.#stored = record;
		this.record = this.round === null ? record : roundView(record, this.round);
	}

	// Follows the URL to a round, by its number from 1, or null for the latest.
	goToRound(number: number | null) {
		this.#wanted = number;
		if (!this.loading) this.viewRound(this.#roundIndex(number));
	}

	#roundIndex(number: number | null): number | null {
		const earlier = this.#stored.rounds?.length ?? 0;
		return number !== null && number >= 1 && number <= earlier ? number - 1 : null;
	}

	// Opens an earlier round, or the latest with null: at once, so the top
	// bar and its links are right straight away, while the pages wait for its
	// files, so its slices never meet another round's. The last one asked
	// for wins.
	switchingRound = $state(false);
	#switch = 0;
	async viewRound(index: number | null) {
		if (index === this.round) return;
		const turn = ++this.#switch;
		this.panel.close();
		this.round = index;
		this.switchingRound = true;
		this.#show(this.#stored);
		try {
			const { files } = await fetchPr(this.ref, index ?? undefined);
			if (this.#closed || turn !== this.#switch) return;
			this.files = files;
			this.panel.load();
		} catch (err) {
			if (turn === this.#switch) this.error = (err as Error).message;
		} finally {
			if (turn === this.#switch) this.switchingRound = false;
		}
	}

	// Keeps the latest round as it is and begins another, waiting, as a new
	// PR does, for its commits and panel to be chosen and for it to be
	// begun. Its panel starts afresh.
	async nextRound() {
		await this.viewRound(null);
		this.panel.reset();
		await this.update((r) => beginRound(r, null));
	}

	// Takes back the latest round, begun or not, for the one before it: its
	// threads, findings and review go with it.
	async dropRound() {
		if (this.roundCount < 2) return;
		if (this.round !== null) await this.viewRound(null);
		if (isGenerating(this.generation)) await this.stopPreparing();
		if (this.generation) {
			await dismissGeneration(this.ref).catch(() => {});
			this.generation = null;
		}
		this.panel.reset();
		await this.update(dropRound);
		const { files } = await fetchPr(this.ref);
		if (this.#closed) return;
		this.files = files;
		this.panel.load();
	}

	// Begins the review with the commits chosen, or the whole PR. With
	// `review`, the panel starts as soon as it's prepared.
	async begin(range: ReviewRange | null, { review = false } = {}) {
		await this.update((r) => {
			if (range) r.range = range;
			else delete r.range;
			if (review) r.reviewWhenPrepared = true;
		});
		await Promise.all([this.prepare(), fetchPr(this.ref).then(({ files }) => !this.#closed && (this.files = files))]);
	}

	// Starts preparing, or attaches to a run already going. Parts already
	// saved are kept; the summary is always rewritten from the rest.
	// With `fresh`, starts again from nothing: for a review begun with the
	// wrong model, say.
	async prepare({ fresh = false } = {}) {
		const { slices, conversation, fileNotes } = this.record;
		// Shown as starting while the model is looked up, so the page goes
		// straight to the steps rather than the overview first.
		this.generation = { ...(this.generation ?? emptyGeneration()), status: 'queued', error: undefined };
		try {
			const model = await this.#reviewModel();
			this.#collect(await startGeneration(this.ref, fresh ? {} : { slices, conversation, fileNotes }, model));
		} catch (err) {
			this.generation = {
				...(this.generation ?? emptyGeneration()),
				status: 'failed',
				error: (err as Error).message
			};
		}
	}

	// The model this review uses. A review without one takes the start page's
	// the first time it's prepared, and keeps it.
	readonly model = $derived(this.record.model);

	async #reviewModel(): Promise<string | undefined> {
		if (this.record.model) return this.record.model;
		const selected = await listModels()
			.then((m) => m.selected)
			.catch(() => undefined);
		if (selected) await this.update((r) => (r.model ??= selected)).catch(() => {});
		return this.record.model ?? selected;
	}

	setModel(model: string) {
		this.update((r) => (r.model = model)).catch(() => {});
	}

	async stopPreparing() {
		const generation = await stopGeneration(this.ref).catch(() => null);
		if (generation) this.#collect(generation);
	}

	// Saves each result a run produces once, however often it's polled.
	// The backend saves each result into the review as it's made; this reads
	// the review again whenever a step has finished, before the run's let go,
	// so the page never shows a step done and its result missing.
	async #collect(next: Generation) {
		if (this.#closed) return;
		if (this.#collected?.id !== next.id) this.#collected = { id: next.id, steps: new Set() };
		const done = this.#collected.steps;
		const finished = (Object.keys(next.steps) as StepName[]).filter((step) => next.steps[step].status === 'done' && !done.has(step));
		if (finished.length || next.status === 'done') {
			for (const step of finished) done.add(step);
			await this.reload().catch(() => {});
			if (this.#closed) return;
			if (finished.includes('summary')) this.panel.applyDefault();
		}

		if (next.status === 'done') {
			this.generation = null;
			this.#stopPolling();
			dismissGeneration(this.ref);
		} else {
			this.generation = next;
			if (isGenerating(next)) this.#startPolling();
			else this.#stopPolling();
		}
	}

	#startPolling() {
		if (this.#poll) return;
		this.#poll = setInterval(async () => {
			try {
				const generation = await getGeneration(this.ref);
				if (generation) this.#collect(generation);
				else if (this.generation) {
					// Runs only live as long as the backend process.
					this.generation = { ...this.generation, status: 'failed', error: 'The backend restarted, so this run was lost.' };
					this.#stopPolling();
				}
			} catch {
				// A missed check-in is fine; the next one catches up.
			}
		}, 2000);
	}

	#stopPolling() {
		if (this.#poll) clearInterval(this.#poll);
		this.#poll = null;
	}
}

// Closed with the reviewer's conclusion, which drafting follows.
export const isConcluded = (note: Note) => note.messages.some((m) => m.conclusion);

// A thread as the model reads it: the reviewer's comments and conclusions
// marked as such, so they aren't answered as questions, a quick question's
// full prompt in place of its label, and one turn per speaker.
export function forModel(messages: NoteMessage[]): { role: NoteMessage['role']; text: string }[] {
	const turns: { role: NoteMessage['role']; text: string }[] = [];
	for (const m of messages) {
		const text = m.comment
			? `A comment I'm posting as written, not a question:\n${m.text}`
			: m.conclusion
				? `My conclusion so far, not a question:\n${m.text}`
				: (m.prompt ?? m.text);
		const last = turns.at(-1);
		if (last?.role === m.role) last.text += `\n\n${text}`;
		else turns.push({ role: m.role, text });
	}
	return turns;
}

export function emptyGeneration(): Generation {
	return {
		id: '',
		status: 'queued',
		steps: {
			slices: { status: 'pending' },
			conversation: { status: 'pending' },
			summary: { status: 'pending' },
			notes: { status: 'pending' }
		},
		results: {}
	};
}

const KEY = Symbol('pr-session');

export function provideSession(session: PrSession) {
	setContext(KEY, session);
}

export function useSession(): PrSession {
	return getContext<PrSession>(KEY);
}
