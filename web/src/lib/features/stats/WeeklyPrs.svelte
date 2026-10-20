<script lang="ts">
	import type { PrStats } from './summary';

	// Each week a column, each PR worked on in it a block, sized by the
	// lines it took: when reviewing happened, and how much there was.
	let { weeks }: { weeks: { from: number; prs: PrStats[] }[] } = $props();

	const GAP = 3;
	const HEIGHT = 140;
	// Blocks by the square root of their lines, so small PRs still show; the
	// busiest week fills the height.
	const weight = (p: PrStats) => Math.sqrt(Math.max(p.lines, 25));
	const scale = $derived(
		Math.min(
			1,
			...weeks.filter((w) => w.prs.length).map((w) => (HEIGHT - GAP * (w.prs.length - 1)) / w.prs.reduce((a, p) => a + weight(p), 0))
		)
	);
	const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
</script>

<div class="weeks">
	<div class="columns" style:height="{HEIGHT}px">
		{#each weeks as w (w.from)}
			<div class="week" title="Week of {day(w.from)}: {w.prs.length} {w.prs.length === 1 ? 'pull request' : 'pull requests'}">
				{#each w.prs as p (p.id)}
					<span class="pr" style:height="{Math.max(4, weight(p) * scale)}px" title="{p.title} · {p.lines.toLocaleString()} lines"></span>
				{/each}
			</div>
		{/each}
	</div>
	<div class="labels faint" aria-hidden="true">
		{#each weeks as w, i (w.from)}<span>{i % 4 === 0 || i === weeks.length - 1 ? day(w.from) : ''}</span>{/each}
	</div>
</div>

<style>
	.weeks {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px 18px 12px;
		border-radius: 14px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.columns,
	.labels {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 6px;
	}
	.week {
		display: flex;
		flex-direction: column-reverse;
		gap: 3px;
		border-bottom: 1px solid var(--line-2);
	}
	.pr {
		border-radius: 3px;
		background: #4f9466;
	}
	.pr:hover {
		background: #7fd89b;
	}
	.labels {
		font-size: 11.5px;
		white-space: nowrap;
	}
</style>
