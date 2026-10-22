import { readOk } from '$lib/api/client';
import type { GitHubThread, PrRef, ThreadCheck } from '$lib/types';

// A PR's GitHub threads and what checking them found, loaded from the PR
// alone: the Overview goes through them, and so can the start page, for a
// PR never opened. Checks run on the backend; while any is under way,
// they're read again until it's done.

export type PrThread = GitHubThread & { now: string };

interface Loaded {
	threads: PrThread[];
	checks: Record<string, ThreadCheck>;
	head: string;
	author?: string;
}

export class PrThreads {
	data = $state<Loaded | null>(null);
	error = $state<string | null>(null);

	readonly threads = $derived(this.data?.threads ?? []);
	readonly checks = $derived(this.data?.checks ?? {});
	readonly head = $derived(this.data?.head);
	readonly author = $derived(this.data?.author);

	#ref: PrRef;
	#model: () => string | undefined;
	// Told after a thread's changed on GitHub, for what else shows them.
	#onchange: () => void;
	#poll: ReturnType<typeof setInterval> | null = null;
	#closed = false;

	constructor(ref: PrRef, { model = () => undefined, onchange = () => {} }: { model?: () => string | undefined; onchange?: () => void } = {}) {
		this.#ref = ref;
		this.#model = model;
		this.#onchange = onchange;
	}

	get #base() {
		return `/api/pr/${this.#ref.owner}/${this.#ref.repo}/${this.#ref.number}`;
	}

	async load() {
		try {
			const data = await readOk<Loaded>(await fetch(`${this.#base}/threads`));
			if (this.#closed) return;
			this.data = data;
			this.error = null;
			if (Object.values(data.checks).some((c) => c.checking)) this.#watch();
		} catch (err) {
			if (!this.#closed) this.error = (err as Error).message;
		}
	}

	async check(threads: GitHubThread[]) {
		if (!threads.length) return;
		await readOk(
			await fetch(`${this.#base}/github-threads/check`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: threads.map((t) => t.id), model: this.#model() })
			})
		);
		await this.load();
	}

	// Replies to, resolves or reopens threads, there and then; they're read
	// again after, so they show as GitHub has them.
	async change(changes: { thread: GitHubThread; resolved?: boolean; reply?: string }[]) {
		const sent = changes.filter((c) => c.thread.node);
		if (!sent.length) return;
		const res = await fetch(`${this.#base}/github-threads`, {
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
		await this.load();
		this.#onchange();
		const refused = results.filter((r) => r.error);
		if (refused.length) throw new Error(`GitHub didn't change ${refused.length === 1 ? 'a thread' : `${refused.length} threads`}: ${refused[0].error}`);
	}

	#watch() {
		if (this.#poll) return;
		this.#poll = setInterval(async () => {
			if (this.#closed || !Object.values(this.checks).some((c) => c.checking)) {
				clearInterval(this.#poll!);
				this.#poll = null;
				return;
			}
			const { checks } = await fetch(`${this.#base}/threads?checks`)
				.then((res) => readOk<{ checks: Loaded['checks'] }>(res))
				.catch(() => ({ checks: this.checks }));
			if (this.data && !this.#closed) this.data = { ...this.data, checks };
		}, 2000);
	}

	close() {
		this.#closed = true;
		if (this.#poll) clearInterval(this.#poll);
	}
}
