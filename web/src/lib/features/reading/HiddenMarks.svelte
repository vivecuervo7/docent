<script lang="ts">
	import MarkIcon from './MarkIcon.svelte';
	import type { Mark } from './marks';

	// The marks on lines a fold is hiding, shown on the fold instead so
	// they're found without opening it. Hangs off the fold's right edge.
	let { marks }: { marks: Mark[] } = $props();
</script>

{#if marks.length}
	<span class="hidden-marks">
		{#each marks as m (m.id)}
			<span class="mark {m.kind}" class:skipped={m.kind === 'finding' && m.included === false} title="{m.kind === 'finding' ? 'A finding' : 'A thread'} is inside">
				<MarkIcon kind={m.kind} small />
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
	.mark.finding.skipped {
		fill: none;
		stroke: var(--agent);
		stroke-width: 1.2;
		opacity: 0.75;
	}
</style>
