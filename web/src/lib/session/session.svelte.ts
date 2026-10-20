import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { fetchCommits, fetchPr, listModels, readOk } from '../api/client';
import { groupsOf, reviewerName } from '../features/panel/findings';
import { dismissGeneration, getGeneration, startGeneration, stopGeneration } from '../features/preparing/generations';
import { type LooseMark, type Mark, looseMarksFrom, marksFrom } from '../features/reading/marks';
import { nearestHunk, parseFilePatch, type Hunk } from '../features/reading/diff/parse';
import { Panel, sessionId } from '../features/panel/panel.svelte';
import { ReviewPost } from '../features/posting/post.svelte';
import { everythingElse, isSliceReviewed } from '../features/reading/progress';
import { readChoice, readPref, writeChoice, writePref } from '../ui/prefs';
import { emptyRecord, getRecord, updateRecord } from '../storage/record';
import { beginRound, dropRound, keepRound, roundView } from '../storage/rounds';
import { isNewFinding, isUnread, noteWhere, type FeedbackItem, type Generation, type GitHubComments, type GitHubThread, type Job, type PrCommit, type LineRef, type Note, type NoteMessage, type PrFile, type PrMeta, type PrRecord, type PrRef, type ReviewRange, type Slice, type StepName } from '../types';

// The open PR: its files, its saved review, and preparing it when parts of
// the review are missing. One per PR, shared with every page under it.

export const GITHUB_IN_DIFF = ['hidden', 'open', 'all'] as const;
export type GitHubInDiff = (typeof GITHUB_IN_DIFF)[number];

export function isGenerating(generation: Generation | null | undefined): boolean {
	return generation?.status === 'queued' || generation?.status === 'running';
}

export { isSliceReviewed };

// A hunk's lines from start to end, with +/- markers.
function codeIn(hunk: Hunk, start: LineRef, end: LineRef): string {
	const within = (r: Hunk['rows'][number]) => {
		const n = start.side === 'new' ? (r.kind !== 'del' ? r.new : undefined) : r.kind !== 'add' ? r.old : undefined;
		return n !== undefined && n >= start.line && n <= end.line;
	};
	return hunk.rows
		.filter(within)
		.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`)
		.join('\n');
}

// Line numbers as ranges: "3-5, 9".
function describeLines(lines: number[]): string {
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
	readonly hunkKeys = $derived(
		this.files.flatMap((f) =>
			(this.hunks.get(f.filename) ?? []).filter((h) => !f.inRange || f.inRange.includes(h.index)).map((h) => `${f.filename}#${h.index}`)
		)
	);
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
			return { index: latest ? null : i, range: r.range, end: latest && !begun(r as PrRecord) ? undefined : (r.range?.to ?? r.preparedHead ?? this.meta?.head) };
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
	readonly post: ReviewPost = new ReviewPost(this);

	#collected: { id: string; steps: Set<StepName> } | null = null;
	#poll: ReturnType<typeof setInterval> | null = null;
	#closed = false;

	constructor(ref: PrRef) {
		this.ref = ref;
	}

	async open() {
		try {
			const [pr, { record }, existing] = await Promise.all([
				fetchPr(this.ref),
				getRecord(this.ref),
				getGeneration(this.ref).catch(() => null)
			]);
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
			fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/github-comments`)
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

	// Threads: asking about or remarking on selected lines, and the model's
	// replies. Replies in flight, or failed, are kept here, not saved.
	// Answers are made on the backend and saved into the review, which says
	// what's awaiting one; this covers the moment before it does, and asking
	// that failed outright.
	#asked = $state<Record<string, { pending?: boolean; error?: string }>>({});
	#statusOf(id: string, saved: { awaiting?: boolean; replyError?: string }) {
		return saved.awaiting ? { pending: true } : saved.replyError ? { error: saved.replyError } : (this.#asked[id] ?? {});
	}
	readonly noteStatus = $derived(Object.fromEntries(this.record.notes.map((n) => [n.id, this.#statusOf(n.id, n)])));

	// With `comment`, the message is one to post as written, and asks for
	// no reply.
	// Without lines, on a whole file; without a path too, on the PR as a whole.
	// With `prompt`, a quick question: the text is its label, the prompt what's asked.
	createNote(
		anchor: { path: string; hunk?: number; start?: LineRef; end?: LineRef; code?: string; github?: string },
		text: string,
		{ comment = false, prompt }: { comment?: boolean; prompt?: string } = {}
	): string {
		const now = Date.now();
		const message: NoteMessage = { role: 'user', text, at: now, ...(comment ? { comment } : {}), ...(prompt ? { prompt } : {}) };
		const note: Note = { id: crypto.randomUUID(), ...anchor, messages: [message], createdAt: now, readAt: now };
		this.update((r) => {
			r.notes = [...r.notes, note];
		})
			.then(() => (comment ? undefined : this.#requestReply(note.id)))
			.catch((err) => (this.#asked[note.id] = { error: (err as Error).message }));
		return note.id;
	}

	// A comment or a conclusion asks for no reply.
	sendNote(id: string, text: string, { comment = false, conclusion = false } = {}) {
		const message: NoteMessage = { role: 'user', text, at: Date.now(), ...(comment ? { comment } : {}), ...(conclusion ? { conclusion } : {}) };
		this.update((r) => {
			r.notes = r.notes.map((n) => (n.id === id ? { ...n, messages: [...n.messages, message] } : n));
		})
			.then(() => (comment || conclusion ? undefined : this.#requestReply(id)))
			.catch((err) => (this.#asked[id] = { error: (err as Error).message }));
	}

	// Begins a thread about something said on GitHub, on the same lines or
	// file, so its reply reads that code beside what was said.
	askAboutGitHub(id: string, text: string, options: { comment?: boolean; prompt?: string } = {}): string | undefined {
		const thread = this.github?.threads.find((t) => t.id === id);
		if (!thread) return this.github?.general.some((c) => c.id === id) ? this.createNote({ path: '', github: id }, text, options) : undefined;
		const { path, start, end } = thread;
		const hunk = start ? nearestHunk(this.hunks.get(path) ?? [], start) : undefined;
		const anchor = start && end && hunk ? { path, start, end, hunk: hunk.index, code: codeIn(hunk, start, end), github: id } : { path, github: id };
		return this.createNote(anchor, text, options);
	}

	// Replies to, resolves or reopens a GitHub thread, there and then. The
	// threads are read again after, so they show as GitHub has them.
	async changeThreads(changes: { thread: GitHubThread; resolved?: boolean; reply?: string }[]) {
		const sent = changes.filter((c) => c.thread.node);
		if (!sent.length) return;
		const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/github-threads`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				changes: sent.map(({ thread, resolved, reply }) => ({
					node: thread.node,
					...(resolved !== undefined ? { resolved } : {}),
					...(reply?.trim() ? { reply: { comment: Number(thread.id.slice(1)), body: reply.trim() } } : {})
				}))
			})
		});
		const { results } = await readOk<{ results: { node: string; error?: string }[] }>(res);
		await this.refreshGitHub().catch(() => {});
		const refused = results.filter((r) => r.error);
		if (refused.length) throw new Error(`GitHub didn't change ${refused.length === 1 ? 'a thread' : `${refused.length} threads`}: ${refused[0].error}`);
	}

	// What's been said on GitHub again, after changing it.
	async refreshGitHub() {
		const comments = await readOk<GitHubComments>(await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/github-comments`));
		if (!this.#closed) this.github = comments;
	}

	// What was said on GitHub that a thread asks about, as text.
	#githubText(id: string): string | undefined {
		const entries = this.github?.threads.find((t) => t.id === id)?.entries ?? this.github?.general.filter((c) => c.id === id);
		return entries?.length ? entries.map((e) => `${e.author}: ${e.body}`).join('\n\n') : undefined;
	}

	retryNote(id: string) {
		this.#requestReply(id);
	}

	removeNote(id: string) {
		this.update((r) => {
			r.notes = r.notes.filter((n) => n.id !== id);
		}).catch(() => {});
	}

	markNoteRead(id: string) {
		const note = this.record.notes.find((n) => n.id === id);
		if (!note || !isUnread(note)) return;
		const readAt = Date.now();
		this.update((r) => {
			r.notes = r.notes.map((n) => (n.id === id ? { ...n, readAt } : n));
		}).catch(() => {});
	}

	// Every file's changes, as far as they fit, for a question about the PR.
	#allChanges() {
		return this.files
			.map((f) => `--- ${f.filename}\n${f.patch ?? ''}`)
			.join('\n\n')
			.slice(0, 120_000);
	}

	async #requestReply(id: string) {
		const note = this.record.notes.find((n) => n.id === id);
		if (!note) return;
		const file = this.files.find((f) => f.filename === note.path);
		const slice = note.hunk === undefined ? undefined : this.slices.find((s) => s.hunks.includes(`${note.path}#${note.hunk}`));
		// A thread without lines is about its whole file, or with no path the PR.
		const lines = note.start ? noteWhere(note) : '';
		const code = note.code ?? '';
		this.#asked[id] = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/notes/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					context: {
						path: note.path,
						lines,
						code,
						fileDiff: note.path ? (file?.patch ?? code) : this.#allChanges(),
						prTitle: this.title,
						prWhat: this.record.summary?.what,
						sliceTitle: slice?.title,
						sliceSummary: slice?.summary,
						...(file?.rangeLines ? { roundLines: describeLines(file.rangeLines.new) } : {}),
						...(note.github ? { github: this.#githubText(note.github) } : {})
					},
					messages: forModel(note.messages),
					model: this.record.model,
					target: { note: id },
					...(this.round !== null ? { round: this.round } : {})
				})
			});
			await readOk(res);
			await this.reload();
			this.#asked[id] = {};
			this.watch();
		} catch (err) {
			this.#asked[id] = { error: (err as Error).message };
		}
	}

	// Questions about a finding, answered by the model that raised it (or the
	// picked model, for the reviewer's own agent). The conversation is saved
	// on the finding, and goes with it into the prepared review.
	readonly findingStatus = $derived(
		Object.fromEntries(
			Object.values(this.record.feedback)
				.flatMap((d) => d?.items ?? [])
				.map((i) => [i.id, this.#statusOf(i.id, i)])
		)
	);

	// The reviewer's conclusion about a finding: what Prepare follows when
	// wording it, or leaving it out. It asks for no answer.
	concludeFinding(reviewer: string, id: string, text: string) {
		const message: NoteMessage = { role: 'user', text, at: Date.now(), conclusion: true };
		this.#changeFinding(reviewer, id, (item) => ({ ...item, messages: [...(item.messages ?? []), message] })).catch(() => {});
	}

	askAboutFinding(reviewer: string, id: string, text: string, prompt?: string) {
		const message = { role: 'user' as const, text, at: Date.now(), ...(prompt ? { prompt } : {}) };
		this.#changeFinding(reviewer, id, (item) => ({ ...item, messages: [...(item.messages ?? []), message] }))
			.then(() => this.#answerFinding(reviewer, id))
			.catch((err) => (this.#asked[id] = { error: (err as Error).message }));
	}

	// Seeing a finding - or a new answer about it - clears it from unread.
	markFindingRead(reviewer: string, id: string) {
		const item = this.record.feedback[reviewer]?.items.find((i) => i.id === id);
		if (!item || !(isUnread(item) || isNewFinding(item))) return;
		const readAt = Date.now();
		this.#changeFinding(reviewer, id, (i) => ({ ...i, readAt })).catch(() => {});
	}

	retryFinding(reviewer: string, id: string) {
		this.#answerFinding(reviewer, id);
	}

	#changeFinding(reviewer: string, id: string, change: (item: FeedbackItem) => FeedbackItem) {
		return this.update((r) => {
			const draft = r.feedback[reviewer];
			if (draft) r.feedback[reviewer] = { ...draft, items: draft.items.map((i) => (i.id === id ? change(i) : i)) };
		});
	}

	async #answerFinding(reviewer: string, id: string) {
		const item = this.record.feedback[reviewer]?.items.find((i) => i.id === id);
		if (!item?.messages?.length) return;
		const { path, start } = item;
		const end = item.end ?? start;
		const file = path ? this.files.find((f) => f.filename === path) : undefined;
		const hunk = path && start ? nearestHunk(this.hunks.get(path) ?? [], start) : undefined;
		const slice = hunk ? this.slices.find((s) => s.hunks.includes(`${path}#${hunk.index}`)) : undefined;
		const code = hunk && start && end ? codeIn(hunk, start, end) : '';
		// A finding about the whole PR is answered from all of its changes, as
		// far as they fit.
		const everything = path ? '' : this.#allChanges();
		const ranWith = this.record.agentReviewers.find((a) => a.id === reviewer)?.ranWith;
		this.#asked[id] = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/notes/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					context: {
						path: path ?? '',
						lines: start && end ? (start.line === end.line ? `line ${start.line}` : `lines ${start.line}-${end.line}`) : '',
						code: start ? code || '(unchanged lines outside the diff)' : '',
						fileDiff: path ? (file?.patch ?? code) : everything,
						prTitle: this.title,
						prWhat: this.record.summary?.what,
						sliceTitle: slice?.title,
						sliceSummary: slice?.summary,
						finding: {
							reviewer: reviewerName(this.record, reviewer),
							body: item.body,
							rationale: item.rationale,
							severity: item.severity,
							// The other reviewers' versions of the point, and what the
							// editor found, so the answer can weigh them.
							others: groupsOf(this.record).membersOf(reviewer, id).map(({ reviewer: r, item: m }) => ({
								reviewer: reviewerName(this.record, r),
								body: m.body,
								severity: m.severity,
								disputed: m.disputed
							})),
							editor: {
								impact: item.impact,
								checked: item.checked,
								speculative: item.speculative,
								onPr: item.onPr,
								setAside: item.setAside
							}
						}
					},
					messages: forModel(item.messages),
					model: this.#answeringModel(ranWith),
					target: { finding: { reviewer, id } },
					...(this.round !== null ? { round: this.round } : {})
				})
			});
			await readOk(res);
			await this.reload();
			this.#asked[id] = {};
			this.watch();
		} catch (err) {
			this.#asked[id] = { error: (err as Error).message };
		}
	}

	// Who answers questions about a finding: the model that raised it; an
	// external reviewer's own model, else the review's; the review's for your
	// own agent.
	#answeringModel(ranWith: string | undefined): string | undefined {
		if (!ranWith || ranWith === 'external') return this.record.model;
		const id = sessionId(ranWith);
		if (id) {
			const external = this.panel.externals.find((e) => e.id === id);
			if (!external?.model) return this.record.model;
			return `${external.runner === 'codex' ? 'codex' : 'claude-code'}:${external.model}`;
		}
		return ranWith;
	}

	// Threads in file order, as they're drafted from.
	readonly threads = $derived.by(() => {
		const order = new Map(this.files.map((f, i) => [f.filename, i]));
		return [...this.record.notes].sort(
			(a, b) =>
				(order.get(a.path) ?? -1) - (order.get(b.path) ?? -1) ||
				(a.hunk ?? -1) - (b.hunk ?? -1) ||
				(a.start?.line ?? 0) - (b.start?.line ?? 0)
		);
	});

	// Whether threads have been added, removed or replied to since the draft.
	readonly threadsChanged = $derived.by(() => {
		const basedOn = this.record.feedback.yours?.basedOn;
		if (!basedOn) return this.threads.length > 0;
		const now = Object.fromEntries(this.threads.map((n) => [n.id, n.messages.length]));
		return JSON.stringify(now) !== JSON.stringify(basedOn);
	});

	// A thread with comments of the reviewer's own is drafted as those
	// comments, word for word and on its lines; the model drafts the rest,
	// following a thread's conclusion where it has one.
	// Drafting runs on the backend as a job on the round; this covers asking
	// for it, before the job's there.
	#drafting = $state<{ pending?: boolean; error?: string }>({});
	readonly yourDraft = $derived.by((): { pending?: boolean; error?: string } => {
		const job = this.record.jobs?.draft;
		if (job?.status === 'running') return { pending: true };
		if (job?.status === 'failed') return { error: job.error };
		return this.#drafting;
	});

	async draftYourComments() {
		const threads = this.threads;
		if (!threads.length) return;
		const rest = threads.filter((n) => !n.messages.some((m) => m.comment));
		const basedOn = Object.fromEntries(threads.map((n) => [n.id, n.messages.length]));
		if (!rest.length) return this.#saveDraft([], basedOn);
		this.#drafting = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/feedback/yours`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: this.record.model,
					prTitle: this.title,
					threads: rest.map((n) => ({
						path: n.path,
						lines: noteWhere(n),
						code: n.code ?? '',
						messages: n.messages.map(({ role, text, conclusion }) => ({ role, text, ...(conclusion ? { conclusion } : {}) })),
						...(n.github ? { github: this.#githubText(n.github) } : {})
					})),
					input: { threads: rest.map((n) => n.id), basedOn },
					...(this.round !== null ? { round: this.round } : {})
				})
			});
			await readOk(res);
			await this.reload();
			this.#drafting = {};
			this.watch();
		} catch (err) {
			this.#drafting = { error: (err as Error).message };
		}
	}

	// A draft the backend has finished, made the round's own: each comment on
	// its threads' lines, or where a conclusion said it applies too.
	async #applyDraft(job: Job) {
		const { threads: ids = [], basedOn = {} } = (job.input ?? {}) as { threads?: string[]; basedOn?: Record<string, number> };
		const { comments = [] } = (job.result ?? {}) as {
			comments?: { threads: number[]; body: string; rationale?: string; at?: { path: string; startLine: number; endLine: number } }[];
		};
		const drafted = comments.map(({ threads: indices, body, rationale, at }): FeedbackItem => {
			// Threads deleted since drop out.
			const sources = indices.flatMap((i) => this.record.notes.filter((n) => n.id === ids[i]));
			const elsewhere =
				at && this.files.some((f) => f.filename === at.path)
					? {
							path: at.path,
							start: { side: 'new' as const, line: at.startLine },
							end: { side: 'new' as const, line: at.endLine },
							noteIds: sources.map((n) => n.id)
						}
					: undefined;
			return { id: crypto.randomUUID(), body, rationale, included: true, ...(elsewhere ?? placeFromThreads(sources)) };
		});
		await this.#saveDraft(drafted, basedOn, job.startedAt);
	}

	// Your comments: those you wrote, word for word on their threads' lines,
	// with what was drafted, in the threads' order. From a job, once.
	async #saveDraft(drafted: FeedbackItem[], basedOn: Record<string, number>, job?: number) {
		const threads = this.threads;
		const asWritten: FeedbackItem[] = threads
			.filter((n) => n.messages.some((m) => m.comment))
			.map((n) => ({
				id: crypto.randomUUID(),
				body: n.messages
					.filter((m) => m.comment)
					.map((m) => m.text.trim())
					.join('\n\n'),
				included: true,
				asWritten: true,
				path: n.path,
				start: n.start,
				end: n.end,
				noteIds: [n.id]
			}));
		const at = (item: FeedbackItem) => threads.findIndex((n) => n.id === item.noteIds?.[0]);
		const items = [...asWritten, ...drafted].sort((a, b) => at(a) - at(b));
		await this.update((r) => {
			if (job !== undefined) {
				if (r.jobs?.draft?.status !== 'done' || r.jobs.draft.startedAt !== job) return;
				delete r.jobs.draft;
			}
			r.feedback.yours = { items, draftedAt: Date.now(), basedOn };
		});
	}

	setYourIncluded(id: string, included: boolean) {
		this.update((r) => {
			const draft = r.feedback.yours;
			if (draft) r.feedback.yours = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, included } : i)) };
		}).catch(() => {});
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
		this.#changeFinding(reviewer, id, ({ joins, ...rest }) => (joins ? { ...rest, separatedFrom: joins } : rest)).catch(() => {});
	}

	// A separated finding back in its group, under whatever now leads it.
	mergeBack(reviewer: string, id: string) {
		const from = this.record.feedback[reviewer]?.items.find((i) => i.id === id)?.separatedFrom;
		const lead = from && this.record.feedback[from.reviewer]?.items.find((i) => i.id === from.id);
		if (!from || !lead) return;
		const joins = lead.joins ?? from;
		this.#changeFinding(reviewer, id, ({ separatedFrom: _, ...rest }) => ({ ...rest, joins })).catch(() => {});
	}

	// A finding the editor filtered out, shown after all.
	keepFiltered(reviewer: string, id: string) {
		this.#changeFinding(reviewer, id, ({ filtered: _, ...rest }) => rest).catch(() => {});
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
		const threads = this.record.notes.filter((n) => isUnread(n) && this.slicesOf(n.path, n.start).includes(sliceId)).length;
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


	// Wrap up's folded lists, kept here so going to the diff and back finds
	// them as they were left, with the scroll position intact.
	wrapUpOpen = $state({ kept: false, skipped: false });
	// Long line excerpts opened out in full, likewise.
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
			const working =
				Object.values(r.jobs ?? {}).some((job) => job?.status === 'running') || r.agentReviewers.some((a) => a.picking);
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
		if (jobs?.draft?.status === 'done') this.#applyDraft(jobs.draft).catch(() => {});
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
		const selected = await listModels().then((m) => m.selected).catch(() => undefined);
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

// Where a comment drafted from threads sits: on their lines when they're all
// in one file, else on the PR as a whole.
// Closed with the reviewer's conclusion, which drafting follows.
export const isConcluded = (note: Note) => note.messages.some((m) => m.conclusion);

// A thread as the model reads it: the reviewer's comments and conclusions
// marked as such, so they aren't answered as questions, a quick question's
// full prompt in place of its label, and one turn per speaker.
function forModel(messages: NoteMessage[]): { role: NoteMessage['role']; text: string }[] {
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

// A comment drawn from threads sits on their lines; on their file when one
// has no lines; and on the PR when they span files or one has no path.
function placeFromThreads(sources: Note[]) {
	const noteIds = sources.map((n) => n.id);
	const paths = new Set(sources.map((n) => n.path));
	if (paths.size !== 1 || !sources[0]?.path) return { noteIds };
	if (sources.some((n) => !n.start || !n.end)) return { path: sources[0].path, noteIds };
	const first = [...sources].sort((a, b) => (a.hunk ?? 0) - (b.hunk ?? 0) || a.start!.line - b.start!.line)[0];
	const last = [...sources].sort((a, b) => (b.hunk ?? 0) - (a.hunk ?? 0) || b.end!.line - a.end!.line)[0];
	return { path: first.path, start: first.start, end: last.end, noteIds };
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
