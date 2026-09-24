<script lang="ts">
	import type { Mark } from '$lib/api';
	import { useSession } from '$lib/session.svelte';
	import InlineText from './InlineText.svelte';

	// An agent's finding, to keep for the review or skip.
	let { mark, onclose }: { mark: Mark; onclose: () => void } = $props();

	const session = useSession();
	let showWhy = $state(false);
	const lines = $derived(
		mark.start.line === mark.end.line ? `line ${mark.start.line}` : `lines ${mark.start.line}–${mark.end.line}`
	);
	const isKept = $derived(mark.included ?? true);
	const keep = (value: boolean) => mark.reviewer && session.setFindingIncluded(mark.reviewer, mark.id, value);
</script>

<div
	class="popover {mark.kind}"
	role="dialog"
	aria-label={mark.kind === 'finding' ? 'Finding' : 'Thread'}
	tabindex="-1"
	onkeydown={(e) => e.key === 'Escape' && onclose()}
>
	<header>
		{#if mark.kind === 'finding'}
			<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .6 11.4 6 6 11.4.6 6Z" fill="var(--agent)" /></svg>
		{:else}
			<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="var(--you)" /></svg>
		{/if}
		<span class="who">{mark.who}</span>
		<span class="faint">{lines}</span>
		<span class="grow"></span>
		<button class="icon" aria-label="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<p class="body"><InlineText text={mark.body} /></p>
	{#if mark.kind === 'finding'}
		{#if mark.rationale}
			<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				Why it was raised
			</button>
			{#if showWhy}<p class="rationale"><InlineText text={mark.rationale} /></p>{/if}
		{/if}
		<footer>
			<button class="btn" class:primary={isKept} aria-pressed={isKept} onclick={() => keep(true)}>Keep</button>
			<button class="btn" class:primary={!isKept} aria-pressed={!isKept} onclick={() => keep(false)}>Skip</button>
		</footer>
	{/if}
</div>

<style>
	.popover {
		position: absolute;
		right: 8px;
		top: calc(100% + 6px);
		z-index: 20;
		width: 420px;
		max-width: calc(100vw - 48px);
		box-sizing: border-box;
		padding: 18px 20px;
		border-radius: 16px;
		background: var(--popover);
		box-shadow:
			0 0 0 1px var(--popover-line),
			0 30px 70px -20px rgba(0, 0, 0, 0.7);
		display: flex;
		flex-direction: column;
		gap: 10px;
		white-space: normal;
		font-family: var(--sans);
		cursor: auto;
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.who {
		font-weight: 500;
		color: var(--agent-text);
	}
	.grow {
		flex-grow: 1;
	}
	.body,
	.rationale {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.6;
		color: var(--text);
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
		gap: 8px;
		padding-top: 4px;
	}
</style>
