import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import * as api from './api';
import { marksFrom } from './api';
import { nearestHunk, parseFilePatch, type Hunk } from './diff/parse';
import { Panel } from './panel.svelte';
import { ReviewPost } from './post.svelte';
import { everythingElse, isSliceReviewed, readPref, writePref } from './review';
import { emptyRecord, getRecord, updateRecord } from './record';
import { isUnread, type FeedbackItem, type Generation, type LineRef, type Note, type PrFile, type PrMeta, type PrRecord, type PrRef, type Slice, type StepName } from './types';

// The open PR: its files, its saved review, and preparing it when parts of
// the review are missing. One per PR, shared with every page under it.

export function isGenerating(generation: Generation | null | undefined): boolean {
	return generation?.status === 'queued' || generation?.status === 'running';
}

export { isSliceReviewed };

export class PrSession {
	readonly ref: PrRef;
	files = $state<PrFile[]>([]);
	meta = $state<PrMeta | null>(null);
	record = $state<PrRecord>(emptyRecord());
	generation = $state<Generation | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);

	// The first preparation of a PR takes over the Overview; a rerun of one
	// that already has a summary happens quietly behind it.
	readonly preparing = $derived(!this.record.summary && this.generation !== null);
	// Viewing preferences, kept in this browser.
	hideWhitespace = $state(readPref('docent.hideWhitespace', true));
	foldTests = $state(readPref('docent.foldTests', true));

	// Each file's hunks, parsed once.
	readonly hunks = $derived(new Map<string, Hunk[]>(this.files.map((f) => [f.filename, parseFilePatch(f.patch ?? '')])));
	readonly hunkKeys = $derived([...this.hunks].flatMap(([path, hunks]) => hunks.map((h) => `${path}#${h.index}`)));
	// The prepared slices, then anything they left out.
	readonly slices = $derived.by(() => {
		const prepared = this.record.slices ?? [];
		const rest = prepared.length ? everythingElse(this.hunkKeys, prepared) : null;
		return rest ? [...prepared, rest] : prepared;
	});
	readonly reviewed = $derived(this.record.reviewed);
	readonly reviewedSlices = $derived(this.slices.filter((s) => isSliceReviewed(s, this.reviewed)).length);
	readonly title = $derived.by(() => this.meta?.title ?? this.record.title ?? `#${this.ref.number}`);

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
				api.fetchPr(this.ref),
				getRecord(this.ref),
				api.getGeneration(this.ref).catch(() => null)
			]);
			if (this.#closed) return;
			this.files = pr.files;
			this.meta = pr.meta;
			this.record = record;
			this.panel.load();
			if (record.summary) this.panel.applyDefault();
			this.update((r) => {
				if (pr.meta?.title) r.title = pr.meta.title;
				if (pr.meta?.author) r.author = pr.meta.author;
				r.lastOpenedAt = Date.now();
			}).catch(() => {});

			if (existing) {
				// Picks up what an earlier visit's run finished meanwhile. A stopped
				// or failed run stays that way until it's resumed.
				this.#collect(existing);
			} else if (!record.slices || !record.conversation || !record.summary || !record.fileNotes) {
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

	// Ticks or unticks hunks, by key (`path#index`).
	setReviewed(keys: string[], value: boolean) {
		return this.update((r) => {
			for (const key of keys) r.reviewed[key] = value;
		});
	}

	// Threads: asking about or remarking on selected lines, and the model's
	// replies. Replies in flight, or failed, are kept here, not saved.
	noteStatus = $state<Record<string, { pending?: boolean; error?: string }>>({});

	createNote(anchor: { path: string; hunk: number; start: LineRef; end: LineRef; code: string }, text: string): string {
		const now = Date.now();
		const note: Note = { id: crypto.randomUUID(), ...anchor, messages: [{ role: 'user', text, at: now }], createdAt: now, readAt: now };
		this.update((r) => {
			r.notes = [...r.notes, note];
		})
			.then(() => this.#requestReply(note.id))
			.catch((err) => (this.noteStatus[note.id] = { error: (err as Error).message }));
		return note.id;
	}

	sendNote(id: string, text: string) {
		this.update((r) => {
			r.notes = r.notes.map((n) => (n.id === id ? { ...n, messages: [...n.messages, { role: 'user', text, at: Date.now() }] } : n));
		})
			.then(() => this.#requestReply(id))
			.catch((err) => (this.noteStatus[id] = { error: (err as Error).message }));
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

	async #requestReply(id: string) {
		const note = this.record.notes.find((n) => n.id === id);
		if (!note) return;
		const file = this.files.find((f) => f.filename === note.path);
		const slice = this.slices.find((s) => s.hunks.includes(`${note.path}#${note.hunk}`));
		const lines = note.start.line === note.end.line ? `line ${note.start.line}` : `lines ${note.start.line}-${note.end.line}`;
		this.noteStatus[id] = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/notes/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					context: {
						path: note.path,
						lines,
						code: note.code,
						fileDiff: file?.patch ?? note.code,
						prTitle: this.title,
						prWhat: this.record.summary?.what,
						sliceTitle: slice?.title,
						sliceSummary: slice?.summary
					},
					messages: note.messages.map(({ role, text }) => ({ role, text }))
				})
			});
			const { text } = await api.readOk<{ text: string }>(res);
			// The thread may have been deleted while the reply was on its way.
			await this.update((r) => {
				r.notes = r.notes.map((n) => (n.id === id ? { ...n, messages: [...n.messages, { role: 'assistant', text, at: Date.now() }] } : n));
			});
			this.noteStatus[id] = {};
		} catch (err) {
			this.noteStatus[id] = { error: (err as Error).message };
		}
	}

	// Questions about a finding, answered by the model that raised it (or the
	// picked model, for the reviewer's own agent). The conversation is saved
	// on the finding, and goes with it into the prepared review.
	findingStatus = $state<Record<string, { pending?: boolean; error?: string }>>({});

	askAboutFinding(reviewer: string, id: string, text: string) {
		this.#changeFinding(reviewer, id, (item) => ({ ...item, messages: [...(item.messages ?? []), { role: 'user', text, at: Date.now() }] }))
			.then(() => this.#answerFinding(reviewer, id))
			.catch((err) => (this.findingStatus[id] = { error: (err as Error).message }));
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
		if (!item?.path || !item.start || !item.messages?.length) return;
		const { path, start } = item;
		const end = item.end ?? start;
		const file = this.files.find((f) => f.filename === path);
		const hunk = nearestHunk(this.hunks.get(path) ?? [], start);
		const slice = hunk && this.slices.find((s) => s.hunks.includes(`${path}#${hunk.index}`));
		const within = (r: { kind: string; new?: number; old?: number }) => {
			const n = start.side === 'new' ? (r.kind !== 'del' ? r.new : undefined) : r.kind !== 'add' ? r.old : undefined;
			return n !== undefined && n >= start.line && n <= end.line;
		};
		const code = (hunk?.rows ?? [])
			.filter(within)
			.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`)
			.join('\n');
		const ranWith = this.record.agentReviewers.find((a) => a.id === reviewer)?.ranWith;
		this.findingStatus[id] = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/notes/reply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					context: {
						path,
						lines: start.line === end.line ? `line ${start.line}` : `lines ${start.line}-${end.line}`,
						code: code || '(unchanged lines outside the diff)',
						fileDiff: file?.patch ?? code,
						prTitle: this.title,
						prWhat: this.record.summary?.what,
						sliceTitle: slice?.title,
						sliceSummary: slice?.summary,
						finding: { reviewer: api.reviewerName(this.record, reviewer), body: item.body, rationale: item.rationale }
					},
					messages: item.messages.map(({ role, text }) => ({ role, text })),
					...(ranWith && ranWith !== 'external' ? { model: ranWith } : {})
				})
			});
			const { text } = await api.readOk<{ text: string }>(res);
			await this.#changeFinding(reviewer, id, (i) => ({ ...i, messages: [...(i.messages ?? []), { role: 'assistant', text, at: Date.now() }] }));
			this.findingStatus[id] = {};
		} catch (err) {
			this.findingStatus[id] = { error: (err as Error).message };
		}
	}

	// Your comments for the review, drafted from your threads.
	yourDraft = $state<{ pending?: boolean; error?: string }>({});

	// Threads in file order, as they're drafted from.
	readonly threads = $derived.by(() => {
		const order = new Map(this.files.map((f, i) => [f.filename, i]));
		return [...this.record.notes].sort(
			(a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0) || a.hunk - b.hunk || a.start.line - b.start.line
		);
	});

	// Whether threads have been added, removed or replied to since the draft.
	readonly threadsChanged = $derived.by(() => {
		const basedOn = this.record.feedback.yours?.basedOn;
		if (!basedOn) return this.threads.length > 0;
		const now = Object.fromEntries(this.threads.map((n) => [n.id, n.messages.length]));
		return JSON.stringify(now) !== JSON.stringify(basedOn);
	});

	async draftYourComments() {
		const threads = this.threads;
		if (!threads.length) return;
		this.yourDraft = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.ref.owner}/${this.ref.repo}/${this.ref.number}/feedback/yours`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prTitle: this.title,
					threads: threads.map((n) => ({
						path: n.path,
						lines: n.start.line === n.end.line ? `line ${n.start.line}` : `lines ${n.start.line}-${n.end.line}`,
						code: n.code,
						messages: n.messages.map(({ role, text }) => ({ role, text }))
					}))
				})
			});
			const { comments } = await api.readOk<{ comments: { threads: number[]; body: string; rationale?: string }[] }>(res);
			const items = comments.map(({ threads: indices, body, rationale }) => ({
				id: crypto.randomUUID(),
				body,
				rationale,
				included: true,
				...placeFromThreads(indices.map((i) => threads[i]).filter(Boolean))
			}));
			await this.update((r) => {
				r.feedback.yours = {
					items,
					draftedAt: Date.now(),
					basedOn: Object.fromEntries(threads.map((n) => [n.id, n.messages.length]))
				};
			});
			this.yourDraft = {};
		} catch (err) {
			this.yourDraft = { error: (err as Error).message };
		}
	}

	setYourIncluded(id: string, included: boolean) {
		this.update((r) => {
			const draft = r.feedback.yours;
			if (draft) r.feedback.yours = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, included } : i)) };
		}).catch(() => {});
	}

	// Keeps or skips an agent's finding for the review.
	setFindingIncluded(reviewer: string, id: string, included: boolean) {
		this.update((r) => {
			const draft = r.feedback[reviewer];
			if (draft) r.feedback[reviewer] = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, included, decided: true } : i)) };
		}).catch(() => {});
	}

	// Every agent finding on a file, with the slices its lines are in: the
	// slice holding its first line, or every slice with its file when it's
	// about the whole file. One about the whole PR is in none.
	readonly findings = $derived.by(() =>
		marksFrom(this.record)
			.filter((m) => m.kind === 'finding')
			.map((mark) => ({ mark, slices: this.slicesOf(mark.path, mark.start) }))
	);

	slicesOf(path: string, start: LineRef | undefined): string[] {
		const hunks = this.hunks.get(path) ?? [];
		const nearest = start && nearestHunk(hunks, start);
		const keys = start ? (nearest ? [`${path}#${nearest.index}`] : []) : hunks.map((h) => `${path}#${h.index}`);
		return this.slices.filter((s) => s.hunks.some((k) => keys.includes(k))).map((s) => s.id);
	}

	// Findings on a slice still waiting on a keep or skip.
	undecidedIn(sliceId: string) {
		return this.findings.filter((f) => !f.mark.decided && f.slices.includes(sliceId)).map((f) => f.mark);
	}

	// A thread or finding to bring into view and open: its file opens, and so
	// does any fold hiding it. Cleared by the file that shows it.
	revealing = $state<string | null>(null);

	// Late findings the reviewer chose to leave for Wrap up, for this visit.
	readonly lateLeft = new SvelteSet<string>();

	// Wrap up's folded lists, kept here so going to the diff and back finds
	// them as they were left, with the scroll position intact.
	wrapUpOpen = $state({ kept: false, skipped: false });
	// Long line excerpts opened out in full, likewise.
	readonly openExcerpts = new SvelteSet<string>();

	// Findings waiting on a decision in slices already reviewed: they landed
	// after the reviewer had moved on.
	readonly late = $derived(
		this.findings.filter((f) => !f.mark.decided && f.slices.some((id) => {
			const slice = this.slices.find((s) => s.id === id);
			return !!slice && isSliceReviewed(slice, this.reviewed);
		})).map((f) => f.mark)
	);

	// Saves a change to the review, and shows the record as saved.
	async update(change: (record: PrRecord) => void): Promise<void> {
		change(this.record);
		const saved = await updateRecord(this.ref, change);
		if (!this.#closed) this.record = saved;
	}

	// Starts preparing, or attaches to a run already going. Parts already
	// saved are kept; the summary is always rewritten from the rest.
	async prepare({ fresh = false } = {}) {
		const { slices, conversation, fileNotes } = this.record;
		try {
			this.#collect(await api.startGeneration(this.ref, fresh ? {} : { slices, conversation, fileNotes }));
		} catch (err) {
			this.generation = {
				...(this.generation ?? emptyGeneration()),
				status: 'failed',
				error: (err as Error).message
			};
		}
	}

	async stopPreparing() {
		const generation = await api.stopGeneration(this.ref).catch(() => null);
		if (generation) this.#collect(generation);
	}

	// Saves each result a run produces once, however often it's polled.
	#collect(next: Generation) {
		if (this.#closed) return;
		if (this.#collected?.id !== next.id) this.#collected = { id: next.id, steps: new Set() };
		const done = this.#collected.steps;
		const { slices, conversation, summary, fileNotes } = next.results;
		const save = (step: StepName, change: (r: PrRecord) => void) => {
			if (done.has(step)) return;
			done.add(step);
			this.update(change).catch(() => {});
		};
		if (slices) save('slices', (r) => (r.slices = slices));
		if (conversation) save('conversation', (r) => (r.conversation = conversation));
		if (summary && !done.has('summary')) {
			save('summary', (r) => (r.summary = summary));
			this.panel.applyDefault();
		}
		if (fileNotes) save('notes', (r) => (r.fileNotes = fileNotes));

		if (next.status === 'done') {
			this.generation = null;
			this.#stopPolling();
			api.dismissGeneration(this.ref);
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
				const generation = await api.getGeneration(this.ref);
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
function placeFromThreads(sources: Note[]) {
	const noteIds = sources.map((n) => n.id);
	if (new Set(sources.map((n) => n.path)).size !== 1) return { noteIds };
	const first = [...sources].sort((a, b) => a.hunk - b.hunk || a.start.line - b.start.line)[0];
	const last = [...sources].sort((a, b) => b.hunk - a.hunk || b.end.line - a.end.line)[0];
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
