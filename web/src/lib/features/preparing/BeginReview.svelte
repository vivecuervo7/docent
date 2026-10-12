<script lang="ts">
	import InlineText from '../../ui/InlineText.svelte';
	import ReviewModel from './ReviewModel.svelte';
	import Spinner from '../../ui/Spinner.svelte';
	import { fetchCommits } from '$lib/api/client';
	import { useSession } from '$lib/session/session.svelte';
	import type { PrCommit } from '$lib/types';

	// Before anything's prepared: which of the PR's commits to review. Both
	// ends of the range snap to commits; a day is labelled at its first.
	// Merge commits are left out, as they bring in the base branch's work.
	// For the next round it starts from the first commit since the last.

	let { next = false }: { next?: boolean } = $props();

	const session = useSession();

	let commits = $state<PrCommit[] | null>(null);
	let error = $state<string | null>(null);
	let from = $state(0);
	let to = $state(0);
	let starting = $state(false);

	$effect(() => {
		fetchCommits(session.ref).then(
			(all) => {
				commits = all.filter((c) => !c.merge);
				to = commits.length - 1;
				// The last round may have ended on a merge, which isn't listed.
				const ended = all.findIndex((c) => c.sha === session.record.preparedHead);
				const since = next && ended >= 0 ? all.slice(ended + 1).find((c) => !c.merge) : undefined;
				if (since) from = commits.findIndex((c) => c.sha === since.sha);
			},
			(err) => (error = (err as Error).message)
		);
	});

	const last = $derived((commits?.length ?? 1) - 1);
	const whole = $derived(from === 0 && to === last);

	const dayOf = (iso: string) => new Date(iso).toDateString();
	function dayLabel(iso: string): string {
		const day = new Date(iso);
		const today = new Date();
		const yesterday = new Date(today.getTime() - 86_400_000);
		if (day.toDateString() === today.toDateString()) return 'Today';
		if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	}
	// Each day's first commit, where its label sits. Where two would run
	// into each other the later day keeps its label: recent work is what's
	// usually picked out.
	const LABEL_ROOM = 52;
	let width = $state(0);
	const days = $derived.by(() => {
		const out: { i: number; label: string }[] = [];
		const px = (i: number) => (last ? (i / last) * width : 0);
		(commits ?? []).forEach((c, i, all) => {
			if (i > 0 && dayOf(all[i - 1].date) === dayOf(c.date)) return;
			const before = out.at(-1);
			if (before && px(i) - px(before.i) < LABEL_ROOM) out.pop();
			out.push({ i, label: dayLabel(c.date) });
		});
		return out;
	});

	// Where commit i sits along the track, matching the knobs' centres.
	const at = (i: number) => `calc(var(--knob) / 2 + (100% - var(--knob)) * ${last ? i / last : 0})`;

	function begin() {
		if (!commits) return;
		starting = true;
		const range = whole ? null : { after: commits[from].parent, to: commits[to].sha };
		if (next) session.startRound(range);
		else session.begin(range);
	}
</script>

<div class="wrap">
	<div class="card">
		<span class="caps">{next ? `Begin round ${session.roundCount + 1}` : 'Begin the review'}</span>
		<h1><InlineText text={session.title} /></h1>
		<span class="faint mono">{session.ref.owner}/{session.ref.repo} #{session.ref.number} · <ReviewModel /></span>

		{#if error}
			<p class="bad">Couldn’t load the commits: {error}</p>
		{:else if !commits}
			<p class="faint loading"><Spinner size={14} /> Loading the commits…</p>
		{:else}
			<p class="lede">
				{#if commits.length === 1}
					One commit.
				{:else if whole}
					All {commits.length} commits.
				{:else}
					{to - from + 1} of {commits.length} commits: the PR as it stands after them, where they changed it.
				{/if}
			</p>

			{#if commits.length > 1}
				<div class="slider" style:--knob="16px">
					<div class="track"></div>
					<div class="fill" style:left={at(from)} style:right="calc(100% - {at(to)})"></div>
					{#each commits as c, i (c.sha)}
						<span class="pip" class:on={i >= from && i <= to} style:left={at(i)}></span>
					{/each}
					<input
						type="range"
						min="0"
						max={last}
						step="1"
						aria-label="First commit"
						class:above={from === last}
						value={from}
						oninput={(e) => (from = Math.min(Number(e.currentTarget.value), to))}
						onchange={(e) => (e.currentTarget.value = String(from))}
					/>
					<input
						type="range"
						min="0"
						max={last}
						step="1"
						aria-label="Last commit"
						value={to}
						oninput={(e) => (to = Math.max(Number(e.currentTarget.value), from))}
						onchange={(e) => (e.currentTarget.value = String(to))}
					/>
				</div>
				<div class="days" style:--knob="16px" bind:clientWidth={width}>
					{#each days as d (d.i)}<span style:left={at(d.i)}>{d.label}</span>{/each}
				</div>
			{/if}

			<ol class="commits">
				{#each commits as c, i (c.sha)}
					<li class:out={i < from || i > to}>
						<span class="mono sha">{c.sha.slice(0, 7)}</span>
						<span class="message"><InlineText text={c.message} /></span>
					</li>
				{/each}
			</ol>

			<div class="actions">
				<button class="btn primary" disabled={starting} onclick={begin}>Prepare</button>
				{#if next}<button class="btn" disabled={starting} onclick={() => (session.choosingRound = false)}>Cancel</button>{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.wrap {
		min-height: calc(100vh - 64px);
		display: grid;
		place-items: center;
		padding: 40px 24px;
		box-sizing: border-box;
	}
	.card {
		width: 100%;
		max-width: 540px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.caps {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--agent);
	}
	h1 {
		margin: 4px 0 0;
		font-family: var(--serif);
		font-weight: 500;
		font-size: 32px;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}
	.mono {
		font-family: var(--mono);
		font-size: 13px;
	}
	.lede {
		margin: 22px 0 4px;
		font-size: 15px;
	}
	.loading {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 22px;
	}
	.bad {
		margin-top: 22px;
		color: var(--danger);
	}

	/* Two native range inputs over one track; only their knobs take the pointer. */
	.slider {
		position: relative;
		height: 24px;
		margin-top: 6px;
	}
	.track,
	.fill {
		position: absolute;
		top: 11px;
		height: 2px;
		border-radius: 1px;
	}
	.track {
		left: 0;
		right: 0;
		background: var(--line-2);
	}
	.fill {
		background: var(--you);
	}
	.pip {
		position: absolute;
		top: 9px;
		width: 6px;
		height: 6px;
		margin-left: -3px;
		border-radius: 50%;
		background: var(--line-2);
	}
	.pip.on {
		background: var(--you);
	}
	input[type='range'] {
		position: absolute;
		inset: 0;
		width: 100%;
		margin: 0;
		background: none;
		appearance: none;
		pointer-events: none;
	}
	input[type='range']:focus-visible {
		outline: none;
	}
	/* Both knobs at the end: the first has to be the one that moves. */
	input.above {
		z-index: 1;
	}
	input[type='range']::-webkit-slider-runnable-track {
		background: none;
	}
	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		pointer-events: auto;
		width: var(--knob);
		height: var(--knob);
		margin-top: 4px;
		border-radius: 50%;
		background: var(--text);
		box-shadow: 0 0 0 3px var(--bg);
		cursor: grab;
	}
	input[type='range']::-moz-range-thumb {
		pointer-events: auto;
		width: var(--knob);
		height: var(--knob);
		border: 0;
		border-radius: 50%;
		background: var(--text);
		box-shadow: 0 0 0 3px var(--bg);
		cursor: grab;
	}
	input[type='range']:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--you);
		outline-offset: 2px;
	}
	.days {
		position: relative;
		height: 18px;
		font-size: 12px;
		color: var(--faint);
	}
	.days span {
		position: absolute;
		transform: translateX(-50%);
		white-space: nowrap;
	}
	.days span:first-child {
		transform: none;
		margin-left: calc(var(--knob) / -2);
	}

	.commits {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14px;
	}
	.commits li {
		display: flex;
		gap: 10px;
		align-items: baseline;
	}
	.commits li.out {
		color: var(--faint);
	}
	.sha {
		color: var(--faint);
		flex-shrink: 0;
	}
	.message {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 18px;
	}
</style>
