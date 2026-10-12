<script lang="ts">
	import { goto } from '$app/navigation';
	import { useSession } from '$lib/session/session.svelte';
	import CommitTrack from './CommitTrack.svelte';
	import { ask } from '$lib/ui/confirm.svelte';

	// The commits this review covers, from any page: a quiet chip with the
	// round and how many of the PR's commits it spans, a pip for each, that
	// opens to every round - each opened from its commits - and, when more
	// have been pushed, the next round to review them in.
	// Merge commits aren't shown: they bring in the base branch's work.

	const session = useSession();
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
				// From the commit before its first, so rounds side by side meet.
				return held.length ? { from: Math.max(0, held[0] - 1), to: held.at(-1)!, tone: s === viewed ? ('in' as const) : ('other' as const) } : null;
			})
			.filter((f) => f !== null)
			.sort((a, b) => (a.tone === 'in' ? 1 : 0) - (b.tone === 'in' ? 1 : 0))
	);
	const fresh = $derived(pips.filter((p) => p.state === 'new').length);
	const earlier = $derived(session.round !== null);

	// A round opens at its Overview, at its own URL.
	function view(index: number | null) {
		open = false;
		goto(session.baseFor(index));
	}

	// Only the latest round can go, so no other round's number, or link, changes.
	async function deleteLatest() {
		open = false;
		const n = spans.length;
		if (!(await ask({ title: `Delete round ${n}?`, body: 'Its threads, findings and review go with it. The commits it covered can go into a new round.', action: 'Delete' })))
			return;
		await session.dropRound();
		goto(session.baseFor(null));
	}

	// The new round becomes the latest, so its URL follows it.
	async function reviewNew() {
		open = false;
		await session.nextRound();
		goto(session.baseFor(null));
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
				<!-- Another round is for new commits, or for splitting a PR's commits up. -->
				{#if latest.to >= 0}
					<div class="next">
						{#if fresh}
							<span class="faint">{fresh} {fresh === 1 ? 'commit' : 'commits'} since round {spans.length}</span>
							<button class="btn" onclick={reviewNew}>Review {fresh === 1 ? 'it' : 'them'} as round {spans.length + 1}</button>
						{:else}
							<button class="btn" onclick={reviewNew}>Start round {spans.length + 1}</button>
						{/if}
					</div>
				{/if}
				{#if spans.length > 1}
					<div class="delete">
						<button class="link danger" onclick={deleteLatest}>Delete round {spans.length}</button>
					</div>
				{/if}
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
	.delete {
		padding: 10px 16px 12px;
		border-top: 1px solid var(--line);
		font-size: 12.5px;
	}
	.link.danger:hover {
		color: var(--danger);
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
</style>
