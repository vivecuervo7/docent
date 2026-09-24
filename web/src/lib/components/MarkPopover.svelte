<script lang="ts">
	import type { Mark } from '$lib/api';
	import { useSession } from '$lib/session.svelte';
	import InlineText from './InlineText.svelte';

	// An agent's finding, to keep for the review or skip. Shown inside a
	// Floating bubble.
	let { mark, onclose }: { mark: Mark; onclose: () => void } = $props();

	const session = useSession();
	let showWhy = $state(false);
	const lines = $derived(
		mark.start.line === mark.end.line ? `line ${mark.start.line}` : `lines ${mark.start.line}–${mark.end.line}`
	);
	const isKept = $derived(mark.included ?? true);
	const keep = (value: boolean) => mark.reviewer && session.setFindingIncluded(mark.reviewer, mark.id, value);
</script>

<div class="finding" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<header>
		<span class="who">{mark.who}</span>
		<span class="where">{mark.path.split('/').pop()} · {lines}</span>
		<button class="icon" aria-label="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<div class="content">
		<p class="body"><InlineText text={mark.body} /></p>
		{#if mark.rationale}
			<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				Why it was raised
			</button>
			{#if showWhy}<p class="rationale"><InlineText text={mark.rationale} /></p>{/if}
		{/if}
	</div>
	<footer>
		<button class="btn" class:primary={isKept} aria-pressed={isKept} onclick={() => keep(true)}>Keep</button>
		<button class="btn" class:primary={!isKept} aria-pressed={!isKept} onclick={() => keep(false)}>Skip</button>
	</footer>
</div>

<style>
	.finding {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 10px 8px 16px;
		border-bottom: 1px solid var(--popover-line);
		font-size: 13px;
	}
	.who {
		font-weight: 500;
		color: var(--agent-text);
		white-space: nowrap;
	}
	.where {
		flex-grow: 1;
		min-width: 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
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
		gap: 8px;
		padding: 0 16px 14px;
	}
</style>
