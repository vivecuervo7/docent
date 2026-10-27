import { readOk } from '../api/client';
import { noteWhere, type FeedbackItem, type Job, type Note } from '../types';
import type { PrSession } from './session.svelte';

// Your comments for the review, drafted from your threads: those you wrote
// as comments word for word, the rest by the model, each redrafted as its
// threads change.
export class YourComments {
	#s: PrSession;

	constructor(session: PrSession) {
		this.#s = session;
	}

	// Threads in file order, as they're drafted from.
	readonly threads = $derived.by(() => {
		const order = new Map(this.#s.files.map((f, i) => [f.filename, i]));
		return [...this.#s.record.notes].sort(
			(a, b) =>
				(order.get(a.path) ?? -1) - (order.get(b.path) ?? -1) ||
				(a.hunk ?? -1) - (b.hunk ?? -1) ||
				(a.start?.line ?? 0) - (b.start?.line ?? 0)
		);
	});

	// Whether threads have been added, removed or replied to since the draft.
	readonly threadsChanged = $derived.by(() => {
		const basedOn = this.#s.record.feedback.yours?.basedOn;
		if (!basedOn) return this.threads.length > 0;
		const now = Object.fromEntries(this.threads.map((n) => [n.id, n.messages.length]));
		return JSON.stringify(now) !== JSON.stringify(basedOn);
	});

	// Threads replied to or added since they were drafted, by id; a thread
	// deleted since counts as changed too.
	readonly changedThreads = $derived.by(() => {
		const basedOn = this.#s.record.feedback.yours?.basedOn ?? {};
		const changed = new Set(this.threads.filter((n) => basedOn[n.id] !== undefined && basedOn[n.id] !== n.messages.length).map((n) => n.id));
		for (const id of Object.keys(basedOn)) if (!this.threads.some((n) => n.id === id)) changed.add(id);
		return changed;
	});
	// Threads with nothing drafted from them to keep: new since the draft, or
	// changed when nothing came of them. Drafted as Wrap up opens; those
	// still waiting on an answer wait for it.
	readonly undrafted = $derived.by(() => {
		const draft = this.#s.record.feedback.yours;
		const drawnOn = new Set((draft?.items ?? []).flatMap((i) => i.noteIds ?? []));
		return this.threads.filter(
			(n) => !n.awaiting && (draft?.basedOn?.[n.id] === undefined || (this.changedThreads.has(n.id) && !drawnOn.has(n.id)))
		);
	});

	// A thread with comments of the reviewer's own is drafted as those
	// comments, word for word and on its lines; the model drafts the rest,
	// following a thread's conclusion where it has one.
	// Drafting runs on the backend as a job on the round; this covers asking
	// for it, before the job's there.
	// Some threads, or all of them: the draft from other threads is kept, and
	// whether each comment is kept or skipped carries over to its redraft.
	#drafting = $state<{ pending?: boolean; error?: string }>({});
	readonly status = $derived.by((): { pending?: boolean; error?: string } => {
		const job = this.#s.record.jobs?.draft;
		if (job?.status === 'running') return { pending: true };
		if (job?.status === 'failed') return { error: job.error };
		return this.#drafting;
	});

	async draft(only?: string[]) {
		const threads = only ? this.threads.filter((n) => only.includes(n.id)) : this.threads;
		const scope = only ?? this.threads.map((n) => n.id);
		if (!threads.length && !only?.length) return;
		const rest = threads.filter((n) => !n.messages.some((m) => m.comment));
		const basedOn = Object.fromEntries(threads.map((n) => [n.id, n.messages.length]));
		if (!rest.length) return this.#saveDraft([], basedOn, scope);
		// What was drafted from these threads before, so a redraft can say
		// which of its comments carries on which, and keep the choice made on it.
		const inScope = new Set(scope);
		const earlier = (this.#s.record.feedback.yours?.items ?? [])
			.filter((i) => !i.asWritten && (i.noteIds ?? []).some((id) => inScope.has(id)))
			.map(({ id, body }) => ({ id, body }));
		this.#drafting = { pending: true };
		try {
			const res = await fetch(`/api/pr/${this.#s.ref.owner}/${this.#s.ref.repo}/${this.#s.ref.number}/feedback/yours`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: this.#s.record.model,
					prTitle: this.#s.title,
					threads: rest.map((n) => ({
						path: n.path,
						lines: n.slice ? `the slice “${this.#s.slices.find((sl) => sl.id === n.slice)?.title ?? n.slice}” as a whole` : noteWhere(n),
						code: n.code ?? '',
						messages: n.messages.map(({ role, text, conclusion }) => ({ role, text, ...(conclusion ? { conclusion } : {}) })),
						...(n.github ? { github: this.#s.conversations.githubText(n.github) } : {})
					})),
					earlier,
					input: { threads: rest.map((n) => n.id), basedOn, scope },
					...(this.#s.round !== null ? { round: this.#s.round } : {})
				})
			});
			await readOk(res);
			await this.#s.reload();
			this.#drafting = {};
			this.#s.watch();
		} catch (err) {
			this.#drafting = { error: (err as Error).message };
		}
	}

	// A draft the backend has finished, made the round's own: each comment on
	// its threads' lines, or where a conclusion said it applies too.
	async applyDraft(job: Job) {
		const { threads: ids = [], basedOn = {}, scope } = (job.input ?? {}) as { threads?: string[]; basedOn?: Record<string, number>; scope?: string[] };
		const { comments = [] } = (job.result ?? {}) as {
			comments?: { threads: number[]; body: string; rationale?: string; replaces?: string; at?: { path: string; startLine: number; endLine: number } }[];
		};
		const drafted = comments.map(({ threads: indices, body, rationale, replaces, at }): FeedbackItem & { replaces?: string } => {
			// Threads deleted since drop out.
			const sources = indices.flatMap((i) => this.#s.record.notes.filter((n) => n.id === ids[i]));
			const elsewhere =
				at && this.#s.files.some((f) => f.filename === at.path)
					? {
							path: at.path,
							start: { side: 'new' as const, line: at.startLine },
							end: { side: 'new' as const, line: at.endLine },
							noteIds: sources.map((n) => n.id)
						}
					: undefined;
			return { id: crypto.randomUUID(), body, rationale, included: true, ...(replaces ? { replaces } : {}), ...(elsewhere ?? placeFromThreads(sources)) };
		});
		await this.#saveDraft(drafted, basedOn, scope ?? Object.keys(basedOn), job.startedAt);
	}

	// Your comments: those you wrote, word for word on their threads' lines,
	// with what was drafted, in the threads' order. What was drafted from
	// threads outside the scope stays as it was. From a job, once.
	async #saveDraft(drafted: (FeedbackItem & { replaces?: string })[], basedOn: Record<string, number>, scope: string[], job?: number) {
		const threads = this.threads;
		const inScope = new Set(scope);
		const asWritten: FeedbackItem[] = threads
			.filter((n) => inScope.has(n.id) && n.messages.some((m) => m.comment))
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
		const sourceKey = (item: FeedbackItem) => [...(item.noteIds ?? [])].sort().join(' ');
		await this.#s.update((r) => {
			if (job !== undefined) {
				if (r.jobs?.draft?.status !== 'done' || r.jobs.draft.startedAt !== job) return;
				delete r.jobs.draft;
			}
			const before = r.feedback.yours;
			const exists = new Set(r.notes.map((n) => n.id));
			const kept = (before?.items ?? []).filter(
				(i) => !(i.noteIds ?? []).some((id) => inScope.has(id)) && (i.noteIds ?? []).some((id) => exists.has(id))
			);
			// A redraft keeps a skip: on what's written as it was, by its thread,
			// and on what's drafted, by the earlier comment it says it replaces.
			const skipped = (before?.items ?? []).filter((i) => !i.included);
			const skippedThreads = new Set(skipped.filter((i) => i.asWritten).map(sourceKey));
			const skippedIds = new Set(skipped.map((i) => i.id));
			const fresh = [
				...asWritten.map((i) => (skippedThreads.has(sourceKey(i)) ? { ...i, included: false } : i)),
				...drafted.map(({ replaces, ...i }) => (replaces && skippedIds.has(replaces) ? { ...i, included: false } : i))
			];
			const based = Object.fromEntries(Object.entries({ ...before?.basedOn, ...basedOn }).filter(([id]) => exists.has(id)));
			r.feedback.yours = { items: [...kept, ...fresh].sort((a, b) => at(a) - at(b)), draftedAt: Date.now(), basedOn: based };
		});
	}

	setIncluded(id: string, included: boolean) {
		this.#s.update((r) => {
			const draft = r.feedback.yours;
			if (draft) r.feedback.yours = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, included } : i)) };
		}).catch(() => {});
	}
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
