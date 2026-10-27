<script lang="ts">
	import { isUnread } from '$lib/types';
	import MarkIcon from './MarkIcon.svelte';
	import type { Mark } from './marks';

	// The marks on lines a fold is hiding, shown on the fold instead so
	// they're found without opening it. Hangs off the fold's right edge.
	// Something new to read in one wears the dot its pin would.
	let { marks }: { marks: Mark[] } = $props();
	const unread = (m: Mark) => (m.kind === 'finding' ? !!m.unread : !!m.note && isUnread(m.note));
</script>

{#if marks.length}
	<span class="hidden-marks">
		{#each marks as m (m.id)}
			<span
				class="mark {m.kind}"
				class:skipped={m.kind === 'finding' && m.included === false}
				title="{m.kind === 'finding' ? 'A finding' : m.kind === 'github' ? 'A GitHub thread' : 'A thread'} is inside"
			>
				<MarkIcon kind={m.kind} small />
				{#if unread(m)}<span class="unread" aria-label="New to read"></span>{/if}
			</span>
		{/each}
	</span>
{/if}

<style>
	.hidden-marks {
		position: absolute;
		left: calc(100% + 8px);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		gap: 4px;
	}
	.mark {
		position: relative;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 22px;
		height: 18px;
		margin-top: 1px;
		border-radius: 9px;
	}
	.mark.finding {
		fill: var(--agent);
	}
	.mark.note {
		fill: var(--you);
	}
	.mark.github {
		fill: none;
		stroke: var(--muted);
		stroke-width: 1.8;
	}
	.mark.finding.skipped {
		fill: none;
		stroke: var(--agent);
		stroke-width: 1.2;
		opacity: 0.75;
	}
	.unread {
		position: absolute;
		top: -2px;
		right: 1px;
		width: 7px;
		height: 7px;
		border-radius: 4px;
		background: var(--you);
		box-shadow: 0 0 0 2px var(--code-bg);
	}
</style>
