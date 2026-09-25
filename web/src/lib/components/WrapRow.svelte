<script lang="ts">
	import FilePath from './FilePath.svelte';
	import type { LineRef } from '$lib/types';
	import NoteText from './NoteText.svelte';

	// One thing that could go into the review: an agent's finding or one of
	// your drafted comments, with keep or skip.
	let {
		kind,
		who,
		path,
		start,
		end,
		body,
		rationale,
		// null while it's still waiting on a decision.
		kept,
		onkeep,
		onskip,
		onshow
	}: {
		kind: 'finding' | 'yours';
		// Who raised it; your own comments go without.
		who?: string;
		path?: string;
		start?: LineRef;
		end?: LineRef;
		body: string;
		rationale?: string;
		kept: boolean | null;
		onkeep: () => void;
		onskip: () => void;
		onshow?: () => void;
	} = $props();

	let showWhy = $state(false);
	const lines = $derived.by(() => {
		if (!start) return undefined;
		const endLine = end?.line ?? start.line;
		return start.line === endLine ? `line ${start.line}` : `lines ${start.line}–${endLine}`;
	});
</script>

<li class="row">
	<div class="text">
		<div class="head">
			{#if who}<span class="who">{who}</span>{/if}
			<span class="where">{#if path}<FilePath {path} {lines} />{:else}the PR as a whole{/if}</span>
			{#if onshow}<button class="link" onclick={onshow}>Show in diff</button>{/if}
		</div>
		<div class="body"><NoteText text={body} /></div>
		{#if rationale}
			<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				{kind === 'finding' ? 'Why it was raised' : 'Why it was drafted'}
			</button>
			{#if showWhy}<div class="rationale"><NoteText text={rationale} /></div>{/if}
		{/if}
	</div>
	<div class="decide" role="group" aria-label="Keep or skip">
		<button class:on={kept === true} aria-pressed={kept === true} onclick={onkeep}>Keep</button>
		<button class:on={kept === false} aria-pressed={kept === false} onclick={onskip}>Skip</button>
	</div>
</li>

<style>
	.row {
		display: flex;
		align-items: flex-start;
		gap: 24px;
		padding: 16px 0;
		border-top: 1px solid var(--line);
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
		font-size: 13px;
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
	.link {
		margin-left: auto;
		flex-shrink: 0;
		border: 0;
		background: none;
		padding: 0;
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.body,
	.rationale {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14.5px;
		line-height: 1.6;
	}
	/* The agent's own reasoning, on the half brown of Docent's thread replies. */
	.rationale {
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--popover) 50%, var(--surface-2));
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
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.decide {
		flex-shrink: 0;
		display: flex;
		padding: 2px;
		border-radius: 9px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.decide button {
		height: 28px;
		padding: 0 12px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.decide button.on {
		background: #ece8df;
		color: #141413;
	}
</style>
