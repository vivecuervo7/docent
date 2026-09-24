<script lang="ts">
	import type { Mark } from '$lib/api';
	import { useSession } from '$lib/session.svelte';
	import InlineText from './InlineText.svelte';

	// A finding to keep or skip, in a list rather than in the diff.
	let { mark, onshow }: { mark: Mark; onshow?: () => void } = $props();
	const session = useSession();
	let showWhy = $state(false);

	const lines = $derived(
		mark.start.line === mark.end.line ? `line ${mark.start.line}` : `lines ${mark.start.line}–${mark.end.line}`
	);
	// Kept unless skipped, as in the diff's bubble.
	const isKept = $derived(mark.included ?? true);
	const decide = (included: boolean) => mark.reviewer && session.setFindingIncluded(mark.reviewer, mark.id, included);
</script>

<article class="card">
	<header>
		<span class="who">{mark.who}</span>
		<span class="where">{mark.path.split('/').pop()} · {lines}</span>
	</header>
	<p class="body"><InlineText text={mark.body} /></p>
	{#if mark.rationale}
		<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
			Why it was raised
		</button>
		{#if showWhy}<p class="rationale"><InlineText text={mark.rationale} /></p>{/if}
	{/if}
	<footer>
		<button class="btn" class:primary={isKept} aria-pressed={isKept} onclick={() => decide(true)}>Keep</button>
		<button class="btn" class:primary={!isKept} aria-pressed={!isKept} onclick={() => decide(false)}>Skip</button>
		<span class="grow"></span>
		{#if onshow}<button class="btn" onclick={onshow}>Show in diff</button>{/if}
	</footer>
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 18px;
		border-radius: 14px;
		background: var(--popover);
		box-shadow: 0 0 0 1px var(--popover-line);
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-size: 13px;
		min-width: 0;
	}
	.who {
		font-weight: 500;
		color: var(--agent-text);
		white-space: nowrap;
	}
	.where {
		min-width: 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.body,
	.rationale {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.6;
	}
	.rationale {
		color: var(--muted);
		font-size: 13.5px;
	}
	.why {
		display: flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.grow {
		flex-grow: 1;
	}
</style>
