<script lang="ts">
	import { readOk } from '$lib/api/client';
	import OverlapMap from '$lib/features/stats/OverlapMap.svelte';
	import type { Stats } from '$lib/features/stats/stats';
	import { summarise } from '$lib/features/stats/summary';
	import Spinner from '$lib/ui/Spinner.svelte';

	// What reviewing has come to, at a glance: when, how much, how the slices
	// cut it down, and how the panel's findings fared.
	let stats = $state<Stats | null>(null);
	let error = $state<string | null>(null);
	fetch('/api/stats')
		.then((res) => readOk<Stats>(res))
		.then((s) => (stats = s))
		.catch((err) => (error = (err as Error).message));

	const s = $derived(stats ? summarise(stats) : null);
	const number = (n: number) => n.toLocaleString();
	const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
	// The scale: four even steps of a round size, the last at about the
	// biggest PR, just under or past it.
	const step = (most: number) => {
		const unit = 10 ** Math.floor(Math.log10(most / 4));
		return ([1, 1.5, 2, 2.5, 5, 10].map((m) => m * unit).find((m) => m * 4 >= most * 0.9) ?? unit * 10);
	};
	const ticks = (most: number) => [1, 2, 3, 4].map((i) => i * step(most));
	const height = (n: number, top: number) => (n > 0 ? Math.max(2, (n / top) * 100) : 0);
	const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${n}`);
</script>

<main>
	<div class="head">
		<a class="btn back" href="/">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
			Back to your reviews
		</a>
		<h1>Stats</h1>
	</div>

	{#if error}
		<p class="bad">Couldn’t read the stats: {error}</p>
	{:else if !s}
		<p class="faint loading"><Spinner size={14} /> Adding it up…</p>
	{:else}
		<section class="figures">
			<div><strong>{number(s.prs)}</strong><span>pull requests</span></div>
			<div><strong>{number(s.lines)}</strong><span>lines read</span></div>
			<div><strong>{number(s.slices)}</strong><span>slices sliced</span></div>
			<div><strong>{number(s.posted)}</strong><span>comments posted</span></div>
		</section>

		{#if s.reviewability.prs.length}
			{@const most = Math.max(1, ...s.reviewability.prs.map((p) => p.lines))}
			{@const top = Math.max(most, step(most) * 4)}
			<section>
				<h2>Slice and dice</h2>
				<p class="lede">
					Pull requests averaged <strong>{number(s.reviewability.pr)}</strong> lines. The average slice was
					<strong>{number(s.reviewability.slice)}</strong> lines.
				</p>
				<div class="chart">
					<div class="axis faint" aria-hidden="true">
						{#each ticks(most) as t (t)}<span style:bottom="{height(t, top)}%">{short(t)}</span>{/each}
					</div>
					<div class="sizes" role="img" aria-label="Each pull request's lines read, with its average slice">
						{#each ticks(most) as t (t)}<span class="grid" style:bottom="{height(t, top)}%"></span>{/each}
						{#each s.reviewability.prs as p, i (i)}
							<span class="pair" title="{p.title}: {number(p.lines)} lines in {p.slices} {p.slices === 1 ? 'slice' : 'slices'} of about {number(p.slice)}">
								<span class="bar pr" style:height="{height(p.lines, top)}%"></span>
								<span class="bar slice" style:height="{height(p.slice, top)}%"></span>
							</span>
						{/each}
					</div>
				</div>
				<div class="key faint"><span class="swatch pr"></span>Lines read in the pull request <span class="swatch slice"></span>Its average slice</div>
			</section>
		{/if}

		{#if s.reviewers.length}
			<section>
				<h2>Reviewers</h2>
				<ul class="reviewers">
					{#each s.reviewers as r (r.id)}
						{@const open = r.raised - r.kept - r.asSuggested - r.kickedBack - r.filtered}
						<li>
							<span class="name">{r.name}</span>
							<span class="count faint">{number(r.raised)} {r.raised === 1 ? 'finding' : 'findings'}</span>
							<span
								class="split"
								title="{r.kept} kept · {r.kickedBack} kicked back · {r.asSuggested} skipped as suggested · {r.filtered} filtered · {open} undecided"
							>
								<span class="kept" style:flex={r.kept}></span>
								<span class="kicked" style:flex={r.kickedBack}></span>
								<span class="suggested" style:flex={r.asSuggested}></span>
								<span class="filtered" style:flex={r.filtered}></span>
								<span class="open" style:flex={open}></span>
							</span>
							<span class="rate">{pct(r.kickedBack, r.kept + r.kickedBack)} kicked back</span>
						</li>
					{/each}
				</ul>
				<div class="key faint">
					<span class="swatch kept"></span>Kept <span class="swatch kicked"></span>Kicked back by you
					<span class="swatch suggested"></span>Skipped as suggested <span class="swatch filtered"></span>Filtered by the editor
					<span class="swatch open"></span>Undecided
				</div>
				{#if s.overlap.reviewers.length > 1}
					<OverlapMap reviewers={s.overlap.reviewers} pairs={s.overlap.pairs} />
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 820px;
		margin: 0 auto;
		padding: 56px 24px 96px;
		display: flex;
		flex-direction: column;
		gap: 40px;
	}
	/* As Settings and Getting started open. */
	.head {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.back {
		align-self: flex-start;
		text-decoration: none;
	}
	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: 38px;
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.loading {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.bad {
		color: var(--danger);
	}
	.figures {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.figures div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.figures strong {
		font-family: var(--serif);
		font-size: 30px;
		font-weight: 500;
	}
	.figures span {
		color: var(--muted);
		font-size: 13.5px;
	}
	.lede {
		margin: 0;
		color: var(--muted);
		font-size: 15px;
	}
	.lede strong {
		color: var(--text);
		font-weight: 500;
	}
	.chart {
		display: flex;
		gap: 8px;
		padding: 14px 14px 0;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	/* The scale, in lines, beside the bars. */
	.axis {
		position: relative;
		width: 30px;
		height: 140px;
		font-size: 11px;
	}
	.axis span {
		position: absolute;
		right: 0;
		transform: translateY(50%);
		line-height: 1;
	}
	.sizes {
		position: relative;
		flex: 1;
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 140px;
		border-bottom: 1px solid var(--line-2);
	}
	.grid {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px dashed var(--line);
	}
	.pair {
		position: relative;
		flex: 1 0 8px;
		max-width: 22px;
		height: 100%;
	}
	.bar {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		border-radius: 2px 2px 0 0;
	}
	.bar.pr,
	.swatch.pr {
		background: var(--line-2);
	}
	.bar.slice,
	.swatch.slice {
		background: #7fd89b;
	}
	.bar.slice {
		left: 2px;
		right: 2px;
	}
	.key {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12.5px;
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-left: 8px;
		border-radius: 2px;
	}
	.swatch:first-child {
		margin-left: 0;
	}
	.reviewers {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.reviewers li {
		display: grid;
		grid-template-columns: 160px 100px minmax(0, 1fr) 120px;
		align-items: center;
		gap: 14px;
		padding: 11px 16px;
		border-top: 1px solid var(--line);
		font-size: 14px;
	}
	.reviewers li:first-child {
		border-top: 0;
	}
	.name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.count {
		font-size: 13px;
	}
	.rate {
		text-align: right;
		color: var(--muted);
		font-size: 13px;
	}
	.split {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		background: var(--surface-2);
	}
	.kept,
	.swatch.kept {
		background: #7fd89b;
	}
	.kicked,
	.swatch.kicked {
		background: #a87670;
	}
	/* Skipped as its reviewer or the editor suggested: their call, not a miss. */
	.suggested,
	.swatch.suggested {
		background: #464850;
	}
	.filtered,
	.swatch.filtered {
		background: var(--line-2);
	}
	.open,
	.swatch.open {
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	@media (max-width: 700px) {
		.figures {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.reviewers li {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.split {
			grid-column: 1 / -1;
		}
	}
</style>
