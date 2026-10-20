<script lang="ts">
	import { goto } from '$app/navigation';
	import InlineText from '../../ui/InlineText.svelte';
	import ReviewModel from './ReviewModel.svelte';
	import Spinner from '../../ui/Spinner.svelte';
	import PanelCard from '../panel/PanelCard.svelte';
	import CommitTrack from '../rounds/CommitTrack.svelte';
	import { fetchCommits } from '$lib/api/client';
	import { useSession } from '$lib/session/session.svelte';
	import type { PrCommit } from '$lib/types';

	// Before anything's prepared: which of the PR's commits to review, and
	// the panel to review them. Both ends of the range snap to commits; a day
	// is labelled at its first. Merge commits are left out, as they bring in
	// the base branch's work. A later round starts from the first commit
	// since the round before, and can be taken back for that round. One begun
	// after a rebase, the round before's last commit gone, reviews what
	// changed since that round: there are no commits to choose between.

	const session = useSession();
	const next = $derived(session.roundCount > 1);

	// The panel starts as the default one, here to be changed before it runs.
	$effect(() => {
		session.panel.applyDefault();
	});

	let commits = $state<PrCommit[] | null>(null);
	let error = $state<string | null>(null);
	let from = $state(0);
	let to = $state(0);
	let starting = $state(false);
	let rebased = $state(false);

	$effect(() => {
		fetchCommits(session.ref).then(
			(all) => {
				commits = all.filter((c) => !c.merge);
				to = commits.length - 1;
				// The last round may have ended on a merge, which isn't listed.
				const ended = all.findIndex((c) => c.sha === session.previousHead);
				rebased = next && !!session.previousHead && ended < 0;
				const since = next && ended >= 0 ? all.slice(ended + 1).find((c) => !c.merge) : undefined;
				if (since) from = commits.findIndex((c) => c.sha === since.sha);
			},
			(err) => (error = (err as Error).message)
		);
	});

	const last = $derived((commits?.length ?? 1) - 1);
	const whole = $derived(from === 0 && to === last);


	// With `review`, the panel starts as soon as it's prepared.
	function begin(review: boolean) {
		if (!commits) return;
		starting = true;
		const range = rebased
			? { after: session.previousHead!, to: commits[last].sha, rebased: true as const }
			: whole
				? null
				: { after: commits[from].parent, to: commits[to].sha };
		session.begin(range, { review });
	}
</script>

<div class="wrap">
	<div class="card">
		<span class="caps">{next ? `Begin round ${session.roundCount}` : 'Begin the review'}</span>
		<h1><InlineText text={session.title} /></h1>
		<span class="faint mono">{session.ref.owner}/{session.ref.repo} #{session.ref.number} · <ReviewModel /></span>

		{#if error}
			<p class="bad">Couldn’t load the commits: {error}</p>
		{:else if !commits}
			<p class="faint loading"><Spinner size={14} /> Loading the commits…</p>
		{:else}
			<p class="lede">
				{#if rebased}
					Rebased since round {session.roundCount - 1}: what changed since it, in the PR as it stands now.
				{:else if commits.length === 1}
					One commit.
				{:else if whole}
					All {commits.length} commits.
				{:else}
					{to - from + 1} of {commits.length} commits: the PR as it stands after them, where they changed it.
				{/if}
			</p>

			{#if commits.length > 1 && !rebased}
				<div class="slider">
					<CommitTrack
						dates={commits.map((c) => c.date)}
						fills={[{ from, to, tone: 'in' }]}
						tones={commits.map((_, i) => (i >= from && i <= to ? 'in' : 'out'))}
					>
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
					</CommitTrack>
				</div>
			{/if}

			<!-- The commits chosen; those either side are only counted. -->
			<ol class="commits">
				{#if from > 0}<li class="out">{from} earlier {from === 1 ? 'commit' : 'commits'}</li>{/if}
				{#each commits.slice(from, to + 1) as c (c.sha)}
					<li>
						<span class="mono sha">{c.sha.slice(0, 7)}</span>
						<span class="message"><InlineText text={c.message} /></span>
					</li>
				{/each}
				{#if to < last}<li class="out">{last - to} later {last - to === 1 ? 'commit' : 'commits'}</li>{/if}
			</ol>

			<div class="actions">
				<button class="btn primary" disabled={starting} onclick={() => begin(true)} title="The panel starts reviewing as soon as it's prepared">
					Prepare and review
				</button>
				<button class="btn" disabled={starting} onclick={() => begin(false)}>Just prepare</button>
				{#if next}<button class="btn" disabled={starting} onclick={() => session.dropRound().then(() => goto(session.base))}>Cancel</button>{/if}
			</div>
		{/if}
	</div>
	<aside><PanelCard beginning /></aside>
</div>

<style>
	.wrap {
		min-height: calc(100vh - 64px);
		max-width: 1120px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: minmax(0, 540px) 440px;
		justify-content: center;
		align-items: start;
		gap: 72px;
		padding: 40px 24px;
		box-sizing: border-box;
	}
	@media (max-width: 1100px) {
		.wrap {
			grid-template-columns: minmax(0, 540px);
			gap: 40px;
		}
	}
	aside {
		position: sticky;
		top: 96px;
		margin-top: 8vh;
	}
	.card {
		margin-top: 8vh;
		width: 100%;
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

	/* Two native range inputs over the track; only their knobs take the pointer. */
	.slider {
		margin-top: 6px;
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
