import { getContext, setContext } from 'svelte';
import * as api from './api';
import { parseFilePatch, type Hunk } from './diff/parse';
import { Panel } from './panel.svelte';
import { autoReviewedKeys, everythingElse, isSliceReviewed, readPref, writePref } from './review';
import { emptyRecord, getRecord, updateRecord } from './record';
import type { Generation, PrFile, PrMeta, PrRecord, PrRef, Slice, StepName } from './types';

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
	autoReviewTests = $state(readPref('docent.autoReviewTests', true));

	// Each file's hunks, parsed once.
	readonly hunks = $derived(new Map<string, Hunk[]>(this.files.map((f) => [f.filename, parseFilePatch(f.patch ?? '')])));
	readonly hunkKeys = $derived([...this.hunks].flatMap(([path, hunks]) => hunks.map((h) => `${path}#${h.index}`)));
	// The prepared slices, then anything they left out.
	readonly slices = $derived.by(() => {
		const prepared = this.record.slices ?? [];
		const rest = prepared.length ? everythingElse(this.hunkKeys, prepared) : null;
		return rest ? [...prepared, rest] : prepared;
	});
	// Test files counted as reviewed from their notes; see review.ts.
	readonly autoReviewed = $derived(autoReviewedKeys(this.record, this.autoReviewTests));
	readonly reviewed = $derived.by(() => {
		if (!this.autoReviewed.size) return this.record.reviewed;
		const merged = { ...this.record.reviewed };
		for (const key of this.autoReviewed) merged[key] = true;
		return merged;
	});
	readonly reviewedSlices = $derived(this.slices.filter((s) => isSliceReviewed(s, this.reviewed)).length);
	readonly title = $derived.by(() => this.meta?.title ?? this.record.title ?? `#${this.ref.number}`);

	readonly panel: Panel = new Panel(this);

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
			this.update((r) => {
				if (pr.meta?.title) r.title = pr.meta.title;
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

	setAutoReviewTests(value: boolean) {
		this.autoReviewTests = value;
		writePref('docent.autoReviewTests', value);
	}

	// Ticks or unticks hunks, by key (`path#index`).
	setReviewed(keys: string[], value: boolean) {
		return this.update((r) => {
			for (const key of keys) r.reviewed[key] = value;
		});
	}

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
		if (summary) save('summary', (r) => (r.summary = summary));
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
