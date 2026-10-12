<script lang="ts">
	import { goto } from '$app/navigation';
	import { useSession } from '$lib/session/session.svelte';
	import CommitTrack from './CommitTrack.svelte';

	// The commits this review covers, from any page: a quiet chip with the
	// round and how many of the PR's commits it spans, a pip for each, that
	// opens to every round - each opened from its commits - and, when more
	// have been pushed, the next round to review them in.
	// Merge commits aren't shown: they bring in the base branch's work.

	const session = useSession();
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	let open = $state(false);

	const all = $derived(session.commits ?? []);
	const at = (sha: string | undefined) => (sha ? all.findIndex((c) => c.sha === sha) : -1);
	// Each round's commits, as positions in `all`: after `from`, up to `to`.
	const spans = $derived(
		session.roundSpans.map((r) => {
			const to = r.end ? at(r.end) : -1;
			return { index: r.index, from: r.range ? at(r.range.after) : -1, to: r.end && to < 0 ? all.length - 1 : to };
		})
	);
	const latest = $derived(spans.at(-1)!);
	const viewed = $derived(spans.find((s) => s.index === session.round) ?? latest);
	// The round number of a span, from 1.
	const numberOf = (s: (typeof spans)[number]) => (s.index ?? spans.length - 1) + 1;
	const covers = (s: (typeof spans)[number], k: number) => k > s.from && k <= s.to;

	const pips = $derived(
		all.flatMap((c, k) => {
			if (c.merge) return [];
			const fresh = latest.to >= 0 && k > Math.max(...spans.map((s) => s.to));
			const state: 'in' | 'new' | 'other' | 'out' = covers(viewed, k) ? 'in' : fresh ? 'new' : spans.some((s) => covers(s, k)) ? 'other' : 'out';
			// The latest round holding it, to open from it.
			const holder = [...spans].reverse().find((s) => covers(s, k));
			return [{ c, k, state, holder }];
		})
	);
	const inView = $derived(pips.filter((p) => p.state === 'in').length);
	// The chip's bar: where the round sits among the commits, as percentages,
	// and where the new ones start.
	const pct = (n: number) => `${(n / pips.length) * 100}%`;
	const firstIn = $derived(pips.findIndex((p) => p.state === 'in'));
	const lastIn = $derived(pips.findLastIndex((p) => p.state === 'in'));
	const firstNew = $derived(pips.findIndex((p) => p.state === 'new'));
	// Each round's stretch of the line, the one open drawn last, over the rest.
	const fills = $derived(
		spans
			.map((s) => {
				const held = pips.flatMap((p, i) => (covers(s, p.k) ? [i] : []));
				return held.length ? { from: held[0], to: held.at(-1)!, tone: s === viewed ? ('in' as const) : ('other' as const) } : null;
			})
			.filter((f) => f !== null)
			.sort((a, b) => (a.tone === 'in' ? 1 : 0) - (b.tone === 'in' ? 1 : 0))
	);
	const fresh = $derived(pips.filter((p) => p.state === 'new').length);
	const earlier = $derived(session.round !== null);

	function view(index: number | null) {
		open = false;
		session.viewRound(index);
	}

	async function reviewNew() {
		open = false;
		await session.nextRound();
		goto(base);
	}

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.rounds')) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});

	const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
</script>

{#if pips.length}
	<div class="rounds">
		<button
			class="pill"
			class:earlier
			aria-haspopup="dialog"
			aria-expanded={open}
			title={earlier ? 'An earlier round: reviewers run, and reviews post, only in the latest' : undefined}
			onclick={() => (open = !open)}
		>
			<span>Round {numberOf(viewed)}</span>
			<span class="bar" aria-hidden="true">
				{#if firstIn >= 0}<i class="in" style:left={pct(firstIn)} style:width={pct(lastIn - firstIn + 1)}></i>{/if}
				{#if firstNew >= 0 && !earlier}<i class="new" style:left={pct(firstNew)} style:right="0"></i>{/if}
			</span>
			<span class="faint">{inView}/{pips.length}</span>
			{#if fresh && !earlier}<span class="fresh">+{fresh}</span>{/if}
		</button>
		{#if open}
			<div class="popover" role="dialog" aria-label="Rounds of this review">
				<div class="strip">
					<CommitTrack
						knob={10}
						dates={pips.map((p) => p.c.date)}
						{fills}
						tones={pips.map((p) => p.state)}
						titles={pips.map(
							(p) =>
								`${p.c.sha.slice(0, 7)} · ${date(p.c.date)} · ${p.c.message}${p.holder ? ` · round ${numberOf(p.holder)}` : ' · not yet reviewed'}`
						)}
						onpip={(i) => pips[i].holder && view(pips[i].holder.index)}
					/>
				</div>
				<ul>
					{#each spans as s (s.index ?? 'latest')}
						{@const count = pips.filter((p) => covers(s, p.k)).length}
						<li>
							{#if s === viewed}
								<span class="current">Round {numberOf(s)}</span>
							{:else}
								<button class="link" onclick={() => view(s.index)}>Round {numberOf(s)}</button>
							{/if}
							<span class="faint">
								{s.to < 0 ? 'choosing its commits' : `${count} ${count === 1 ? 'commit' : 'commits'}`}{s.index === null ? ' · latest' : ''}
							</span>
						</li>
					{/each}
				</ul>
				{#if fresh}
					<div class="next">
						<span class="faint">{fresh} {fresh === 1 ? 'commit' : 'commits'} since round {spans.length}</span>
						<button class="btn" onclick={reviewNew}>Review {fresh === 1 ? 'it' : 'them'} as round {spans.length + 1}</button>
					</div>
				{/if}
				{#if earlier}<p class="note faint">Reviewers run, and reviews post, only in the latest round.</p>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.rounds {
		position: relative;
	}
	.pill {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 12px;
		border: 0;
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.pill:hover,
	.pill[aria-expanded='true'] {
		background: var(--surface-2);
		color: var(--text);
	}
	.pill.earlier {
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.pill > span {
		white-space: nowrap;
	}
	.bar {
		position: relative;
		width: 32px;
		height: 4px;
		border-radius: 2px;
		background: var(--line-2);
	}
	.bar i {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 2px;
	}
	.bar i.in {
		background: var(--you);
	}
	.bar i.new {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.fresh {
		color: var(--you);
		font-size: 12.5px;
	}
	.popover {
		position: absolute;
		z-index: 40;
		top: calc(100% + 8px);
		right: 0;
		width: 360px;
		padding: 14px 0 0;
		border-radius: 14px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 30px 70px -20px rgba(0, 0, 0, 0.7);
	}
	.strip {
		padding: 0 18px 10px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 9px 16px;
		border-top: 1px solid var(--line);
		font-size: 13.5px;
	}
	.current {
		color: var(--text);
		font-weight: 500;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.next {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 12px 16px 14px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
	.note {
		margin: 0;
		padding: 10px 16px 14px;
		border-top: 1px solid var(--line);
		font-size: 12.5px;
	}
</style>
