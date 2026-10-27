import { readOk } from '../api/client';
import { groupsOf, reviewerName } from '../features/panel/findings';
import { codeIn, nearestHunk } from '../features/reading/diff/parse';
import { sessionId } from '../features/panel/setup';
import { isNewFinding, isUnread, lineSpan, noteWhere, type GitHubThread, type LineRef, type Note, type NoteMessage, type Slice } from '../types';
import { forModel, lineRanges, type PrSession } from './session.svelte';

// Asking about the code and its findings: threads on lines, files, the
// slice or the PR, and questions about a finding, each answered on the
// backend and saved into the review.
export class Conversations {
	#s: PrSession;

	constructor(session: PrSession) {
		this.#s = session;
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
	readonly noteStatus = $derived.by(() => Object.fromEntries(this.#s.record.notes.map((n) => [n.id, this.#statusOf(n.id, n)])));

	// With `comment`, the message is one to post as written, and asks for
	// no reply.
	// Without lines, on a whole file; without a path too, on the PR as a whole.
	// With `prompt`, a quick question: the text is its label, the prompt what's asked.
	createNote(
		anchor: { path: string; slice?: string; hunk?: number; start?: LineRef; end?: LineRef; code?: string; github?: string },
		text: string,
		{ comment = false, prompt }: { comment?: boolean; prompt?: string } = {}
	): string {
		const now = Date.now();
		const message: NoteMessage = { role: 'user', text, at: now, ...(comment ? { comment } : {}), ...(prompt ? { prompt } : {}) };
		const note: Note = { id: crypto.randomUUID(), ...anchor, messages: [message], createdAt: now, readAt: now };
		this.#s.update((r) => {
			r.notes = [...r.notes, note];
		})
			.then(() => (comment ? undefined : this.#requestReply(note.id)))
			.catch((err) => (this.#asked[note.id] = { error: (err as Error).message }));
		return note.id;
	}

	// A comment or a conclusion asks for no reply.
	sendNote(id: string, text: string, { comment = false, conclusion = false } = {}) {
		const message: NoteMessage = { role: 'user', text, at: Date.now(), ...(comment ? { comment } : {}), ...(conclusion ? { conclusion } : {}) };
		this.#s.update((r) => {
			r.notes = r.notes.map((n) => (n.id === id ? { ...n, messages: [...n.messages, message] } : n));
		})
			.then(() => (comment || conclusion ? undefined : this.#requestReply(id)))
			.catch((err) => (this.#asked[id] = { error: (err as Error).message }));
	}

	// Begins a thread about something said on GitHub, on the same lines or
	// file, so its reply reads that code beside what was said. A thread shown
	// from elsewhere comes with the question, as the review's own copy of
	// what's on GitHub may not have it yet.
	askAboutGitHub(id: string, text: string, options: { comment?: boolean; prompt?: string; thread?: GitHubThread } = {}): string | undefined {
		if (options.thread) this.#githubAsked.set(id, options.thread);
		const thread = options.thread ?? this.#s.github?.threads.find((t) => t.id === id);
		if (!thread) return this.#s.github?.general.some((c) => c.id === id) ? this.createNote({ path: '', github: id }, text, options) : undefined;
		const { path, start, end } = thread;
		const hunk = start ? nearestHunk(this.#s.hunks.get(path) ?? [], start) : undefined;
		const anchor = start && end && hunk ? { path, start, end, hunk: hunk.index, code: codeIn(hunk, start, end), github: id } : { path, github: id };
		return this.createNote(anchor, text, options);
	}

	// What was said on GitHub that a thread asks about, as text.
	// Threads asked about as they were shown, for what the review's copy lacks.
	#githubAsked = new Map<string, GitHubThread>();
	githubText(id: string): string | undefined {
		const entries =
			this.#s.github?.threads.find((t) => t.id === id)?.entries ?? this.#githubAsked.get(id)?.entries ?? this.#s.github?.general.filter((c) => c.id === id);
		return entries?.length ? entries.map((e) => `${e.author}: ${e.body}`).join('\n\n') : undefined;
	}

	retryNote(id: string) {
		this.#requestReply(id);
	}

	removeNote(id: string) {
		this.#s.update((r) => {
			r.notes = r.notes.filter((n) => n.id !== id);
		}).catch(() => {});
	}

	markNoteRead(id: string) {
		const note = this.#s.record.notes.find((n) => n.id === id);
		if (!note || !isUnread(note)) return;
		const readAt = Date.now();
		this.#s.update((r) => {
			r.notes = r.notes.map((n) => (n.id === id ? { ...n, readAt } : n));
		}).catch(() => {});
	}

	// Every file's changes, as far as they fit, for a question about the PR.
	#allChanges() {
		return this.#s.files
			.map((f) => `--- ${f.filename}\n${f.patch ?? ''}`)
			.join('\n\n')
			.slice(0, 120_000);
	}

	// The changes to a slice's files, for a question about the slice.
	#sliceChanges(slice: Slice) {
		const paths = new Set(slice.hunks.map((k) => k.slice(0, k.lastIndexOf('#'))));
		return this.#s.files
			.filter((f) => paths.has(f.filename))
			.map((f) => `--- ${f.filename}\n${f.patch ?? ''}`)
			.join('\n\n')
			.slice(0, 120_000);
	}

	async #requestReply(id: string) {
		const note = this.#s.record.notes.find((n) => n.id === id);
		if (!note) return;
		const file = this.#s.files.find((f) => f.filename === note.path);
		const slice = note.slice
			? this.#s.slices.find((s) => s.id === note.slice)
			: note.hunk === undefined
				? undefined
				: this.#s.slices.find((s) => s.hunks.includes(`${note.path}#${note.hunk}`));
		// A thread without lines is about its whole file, or with no path the PR.
		const lines = note.start ? noteWhere(note) : '';
		const code = note.code ?? '';
		this.#asked[id] = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.#s.ref.owner}/${this.#s.ref.repo}/${this.#s.ref.number}/notes/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					context: {
						path: note.path,
						lines,
						code,
						fileDiff: note.path ? (file?.patch ?? code) : note.slice && slice ? this.#sliceChanges(slice) : this.#allChanges(),
						...(note.slice ? { wholeSlice: true } : {}),
						prTitle: this.#s.title,
						prWhat: this.#s.record.summary?.what,
						sliceTitle: slice?.title,
						sliceSummary: slice?.summary,
						...(file?.rangeLines ? { roundLines: lineRanges(file.rangeLines.new) } : {}),
						...(note.github ? { github: this.githubText(note.github) } : {})
					},
					messages: forModel(note.messages),
					model: this.#s.record.model,
					target: { note: id },
					...(this.#s.round !== null ? { round: this.#s.round } : {})
				})
			});
			await readOk(res);
			await this.#s.reload();
			this.#asked[id] = {};
			this.#s.watch();
		} catch (err) {
			this.#asked[id] = { error: (err as Error).message };
		}
	}

	// Questions about a finding, answered by the model that raised it (or the
	// picked model, for the reviewer's own agent). The conversation is saved
	// on the finding, and goes with it into the prepared review.
	readonly findingStatus = $derived.by(() =>
		Object.fromEntries(
			Object.values(this.#s.record.feedback)
				.flatMap((d) => d?.items ?? [])
				.map((i) => [i.id, this.#statusOf(i.id, i)])
		)
	);

	// The reviewer's conclusion about a finding: what Prepare follows when
	// wording it, or leaving it out. It asks for no answer.
	concludeFinding(reviewer: string, id: string, text: string) {
		const message: NoteMessage = { role: 'user', text, at: Date.now(), conclusion: true };
		this.#s.changeFinding(reviewer, id, (item) => ({ ...item, messages: [...(item.messages ?? []), message] })).catch(() => {});
	}

	askAboutFinding(reviewer: string, id: string, text: string, prompt?: string) {
		const message = { role: 'user' as const, text, at: Date.now(), ...(prompt ? { prompt } : {}) };
		this.#s.changeFinding(reviewer, id, (item) => ({ ...item, messages: [...(item.messages ?? []), message] }))
			.then(() => this.#answerFinding(reviewer, id))
			.catch((err) => (this.#asked[id] = { error: (err as Error).message }));
	}

	// Seeing a finding - or a new answer about it - clears it from unread.
	markFindingRead(reviewer: string, id: string) {
		const item = this.#s.record.feedback[reviewer]?.items.find((i) => i.id === id);
		if (!item || !(isUnread(item) || isNewFinding(item))) return;
		const readAt = Date.now();
		this.#s.changeFinding(reviewer, id, (i) => ({ ...i, readAt })).catch(() => {});
	}

	retryFinding(reviewer: string, id: string) {
		this.#answerFinding(reviewer, id);
	}


	async #answerFinding(reviewer: string, id: string) {
		const item = this.#s.record.feedback[reviewer]?.items.find((i) => i.id === id);
		if (!item?.messages?.length) return;
		const { path, start } = item;
		const end = item.end ?? start;
		const file = path ? this.#s.files.find((f) => f.filename === path) : undefined;
		const hunk = path && start ? nearestHunk(this.#s.hunks.get(path) ?? [], start) : undefined;
		const slice = hunk ? this.#s.slices.find((s) => s.hunks.includes(`${path}#${hunk.index}`)) : undefined;
		const code = hunk && start && end ? codeIn(hunk, start, end) : '';
		// A finding about the whole PR is answered from all of its changes, as
		// far as they fit.
		const everything = path ? '' : this.#allChanges();
		const ranWith = this.#s.record.agentReviewers.find((a) => a.id === reviewer)?.ranWith;
		this.#asked[id] = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.#s.ref.owner}/${this.#s.ref.repo}/${this.#s.ref.number}/notes/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					context: {
						path: path ?? '',
						lines: start && end ? lineSpan(start.line, end.line) : '',
						code: start ? code || '(unchanged lines outside the diff)' : '',
						fileDiff: path ? (file?.patch ?? code) : everything,
						prTitle: this.#s.title,
						prWhat: this.#s.record.summary?.what,
						sliceTitle: slice?.title,
						sliceSummary: slice?.summary,
						finding: {
							reviewer: reviewerName(this.#s.record, reviewer),
							body: item.body,
							rationale: item.rationale,
							severity: item.severity,
							// The other reviewers' versions of the point, and what the
							// editor found, so the answer can weigh them.
							others: groupsOf(this.#s.record).membersOf(reviewer, id).map(({ reviewer: r, item: m }) => ({
								reviewer: reviewerName(this.#s.record, r),
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
					...(this.#s.round !== null ? { round: this.#s.round } : {})
				})
			});
			await readOk(res);
			await this.#s.reload();
			this.#asked[id] = {};
			this.#s.watch();
		} catch (err) {
			this.#asked[id] = { error: (err as Error).message };
		}
	}

	// Who answers questions about a finding: the model that raised it; an
	// external reviewer's own model, else the review's; the review's for your
	// own agent.
	#answeringModel(ranWith: string | undefined): string | undefined {
		if (!ranWith || ranWith === 'external') return this.#s.record.model;
		const id = sessionId(ranWith);
		if (id) {
			const external = this.#s.panel.externals.find((e) => e.id === id);
			if (!external?.model) return this.#s.record.model;
			if (external.runner === 'provider') return `${external.provider}:${external.model}`;
			return `${external.runner === 'codex' ? 'codex' : 'claude-code'}:${external.model}`;
		}
		return ranWith;
	}
}
