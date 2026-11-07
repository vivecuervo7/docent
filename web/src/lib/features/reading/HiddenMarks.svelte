<script lang="ts">
	import { isUnread } from '#lib/types.js';
	import MarkIcon from './MarkIcon.svelte';
	import type { Mark } from './marks';
	import { foldedFinding } from './quietFolds';

	// The marks on lines a fold is hiding, shown on the fold instead so
	// they're found without opening it. Hangs off the fold's right edge.
	// Something new to read in one wears the dot its pin would. Its findings
	// show as one, where the first of them sits.
	let { marks }: { marks: Mark[] } = $props();
	const finding = $derived(foldedFinding(marks));
	const first = $derived(marks.find((m) => m.kind === 'finding'));
	const shown = $derived(marks.filter((m) => m.kind !== 'finding' || m === first));
	const unread = (m: Mark) => (m.kind === 'finding' ? !!finding?.unread : !!m.note && isUnread(m.note));
	const findingTitle = $derived(
		!finding
			? ''
			: finding.count > 1
				? `${finding.count} findings are inside`
				: finding.state === 'skipped' && first?.skipSuggested && !first.decided
					? 'A finding suggested for skipping is inside'
					: `A ${{ kept: '', skipped: 'skipped ', filtered: 'filtered-out ' }[finding.state]}finding is inside`
	);
</script>

{#if shown.length}
	<span class="hidden-marks">
		{#each shown as m (m.id)}
			<span
				class="mark {m.kind}"
				class:skipped={m.kind === 'finding' && finding?.state === 'skipped'}
				class:filtered={m.kind === 'finding' && finding?.state === 'filtered'}
				title={m.kind === 'finding' ? findingTitle : `${m.kind === 'github' ? 'A GitHub thread' : 'A thread'} is inside`}
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
	.mark.finding.filtered {
		fill: none;
		stroke: var(--faint);
		stroke-width: 1.2;
		stroke-dasharray: 2 1.6;
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
