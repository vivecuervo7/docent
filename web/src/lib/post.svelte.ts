import * as api from './api';
import type { Hunk } from './diff/parse';
import type { PrSession } from './session.svelte';
import type { FeedbackItem, LineRef, ReviewComment, ReviewDraft, ReviewPayload } from './types';

// Posting the review: preparing it from what's kept (comments making the same
// point merged, anything already said on the PR set aside), wording it, and
// sending it to GitHub. The prepared review is saved in the record, in the
// same shape the React app uses.

const inHunks = (hunks: Hunk[], ref: LineRef) =>
	hunks.some((h) => h.rows.some((r) => (ref.side === 'new' ? r.kind !== 'del' && r.new === ref.line : r.kind !== 'add' && r.old === ref.line)));

export class ReviewPost {
	readonly #session: PrSession;
	prepareStatus = $state<{ pending?: boolean; error?: string }>({});
	// Who's reviewing and who wrote the PR: GitHub won't let you approve or
	// request changes on your own PR.
	people = $state<{ viewer: string; author: string } | null>(null);
	showDropped = $state(false);

	constructor(session: PrSession) {
		this.#session = session;
	}

	get draft(): ReviewDraft | undefined {
		return this.#session.record.review;
	}

	// Everything kept for the review: your comments, and the panel's findings.
	// A finding still waiting on a decision is kept by default.
	readonly candidates = $derived.by(() => {
		const { feedback } = this.#session.record;
		return Object.entries(feedback).flatMap(([source, draft]) =>
			(draft?.items ?? []).filter((item) => item.included).map((item) => ({ item, source }))
		);
	});

	// Whether what's kept has changed since the review was prepared.
	readonly stale = $derived.by(() => {
		const draft = this.draft;
		if (!draft || draft.posted) return false;
		const ids = this.candidates.map((c) => c.item.id);
		return ids.length !== draft.basedOn.length || ids.some((id) => !draft.basedOn.includes(id));
	});

	// GitHub takes a comment on lines only if they're in the PR's diff as it
	// stands: not lines the reviewer expanded, and not a whole file.
	isInline(comment: Pick<ReviewComment, 'path' | 'start' | 'end'>): boolean {
		const hunks = comment.path ? this.#session.hunks.get(comment.path) : undefined;
		return !!hunks && !!comment.start && !!comment.end && inHunks(hunks, comment.start) && inHunks(hunks, comment.end);
	}

	#url(path: string) {
		const { owner, repo, number } = this.#session.ref;
		return `/api/pr/${owner}/${repo}/${number}/review/${path}`;
	}

	#save(review: ReviewDraft | undefined) {
		return this.#session.update((r) => {
			r.review = review;
		});
	}

	loadPeople() {
		if (this.people) return;
		fetch(this.#url('viewer'))
			.then((res) => api.readOk<{ viewer: string; author: string }>(res))
			.then((people) => (this.people = people))
			.catch(() => {});
	}

	async prepare() {
		const candidates = this.candidates;
		this.prepareStatus = { pending: true };
		try {
			const res = await fetch(this.#url('prepare'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					candidates: candidates.map(({ item, source }) => ({
						id: item.id,
						source: source === 'yours' ? 'yours' : 'agent',
						location: item.path
							? `${item.path}${item.start && item.end ? ` ${describeLines(item.start, item.end)}` : ''}`
							: 'the PR as a whole',
						body: item.body,
						inline: this.isInline(item)
					}))
				})
			});
			const prepared = await api.readOk<{
				comments: { from: string[]; body: string }[];
				dropped: { from: string[]; reason: string }[];
				body: string;
			}>(res);
			const byId = new Map(candidates.map((c) => [c.item.id, c.item]));
			await this.#save({
				preparedAt: Date.now(),
				basedOn: candidates.map((c) => c.item.id),
				// A merged comment sits on the lines of the first item it came from
				// that has any.
				comments: prepared.comments.map(({ from, body }) => {
					const anchor = from.map((id) => byId.get(id)).find((item) => item?.path);
					return { id: crypto.randomUUID(), body, included: true, from, path: anchor?.path, start: anchor?.start, end: anchor?.end };
				}),
				dropped: prepared.dropped,
				summary: prepared.body,
				event: this.draft?.event ?? 'COMMENT',
				summaryLeftOut: this.draft?.summaryLeftOut
			});
			this.prepareStatus = {};
		} catch (err) {
			this.prepareStatus = { error: (err as Error).message };
		}
	}

	change(update: (draft: ReviewDraft) => ReviewDraft) {
		const draft = this.draft;
		if (draft) this.#save(update(draft)).catch(() => {});
	}

	setComment(id: string, change: Partial<ReviewComment>) {
		this.change((d) => ({ ...d, comments: d.comments.map((c) => (c.id === id ? { ...c, ...change } : c)) }));
	}

	// Kept feedback set aside as already said, back in the review as it was.
	// With no lines in the diff to sit on, it joins the review's text.
	restoreDropped(index: number) {
		const items = new Map(this.candidates.map((c) => [c.item.id, c.item]));
		this.change((d) => {
			const sources = d.dropped[index].from.map((id) => items.get(id)).filter((i): i is FeedbackItem => !!i);
			const dropped = d.dropped.filter((_, i) => i !== index);
			if (!sources.length) return { ...d, dropped };
			const anchor = sources.find((i) => i.path);
			const text = sources.map((i) => i.body).join('\n\n');
			if (!anchor || !this.isInline(anchor)) {
				return { ...d, dropped, summary: [d.summary.trim(), text].filter(Boolean).join('\n\n'), summaryLeftOut: false };
			}
			const comment = { id: crypto.randomUUID(), body: text, included: true, from: sources.map((i) => i.id), path: anchor.path, start: anchor.start, end: anchor.end };
			return { ...d, dropped, comments: [...d.comments, comment] };
		});
	}

	#send(draft: ReviewDraft, dryRun: boolean) {
		return fetch(this.#url('post'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				dryRun,
				event: draft.event,
				summary: draft.summaryLeftOut ? '' : draft.summary,
				comments: draft.comments.filter((c) => c.included && c.body.trim()).map(({ body, path, start, end }) => ({ body, path, start, end }))
			})
		});
	}

	// Exactly what posting would send, without sending it.
	async preview(): Promise<ReviewPayload> {
		if (!this.draft) throw new Error('Nothing prepared yet.');
		return (await api.readOk<{ payload: ReviewPayload }>(await this.#send(this.draft, true))).payload;
	}

	async post() {
		const draft = this.draft;
		if (!draft) return;
		// A little before now, allowing for the clocks here and at GitHub.
		const since = Date.now() - 30_000;
		try {
			const { url } = await api.readOk<{ url: string }>(await this.#send(draft, false));
			await this.#save({ ...draft, posted: { at: Date.now(), url } });
		} catch (err) {
			// The post can succeed and its answer still be lost on the way back.
			// Only report a failure once GitHub confirms nothing arrived.
			const found = await fetch(`${this.#url('posted-since')}?since=${since}`)
				.then((res) => api.readOk<{ url: string | null }>(res))
				.then((r) => r.url)
				.catch(() => null);
			if (!found) throw err;
			await this.#save({ ...draft, posted: { at: Date.now(), url: found } });
		}
	}

	startOver() {
		this.#save(undefined).catch(() => {});
	}
}

export function describeLines(start: LineRef, end: LineRef): string {
	return start.line === end.line ? `line ${start.line}` : `lines ${start.line}–${end.line}`;
}
