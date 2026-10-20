<script lang="ts">
	import { readOk } from '$lib/api/client';
	import ActivityMap from '$lib/features/stats/ActivityMap.svelte';
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
	// Sizes on a square-root scale, so small PRs still show beside big ones,
	// up to most PRs' size: the few far bigger run off the top.
	const height = (n: number, top: number) => (n > 0 ? Math.max(2, Math.min(100, Math.sqrt(n / top) * 100)) : 0);
</script>

<main>
	<div class="head">
		<a class="back faint" href="/">← Pull requests</a>
		<h1>Stats</h1>
	</div>

	{#if error}
		<p class="bad">Couldn’t read the stats: {error}</p>
	{:else if !s}
		<p class="faint loading"><Spinner size={14} /> Adding it up…</p>
	{:else}
		<section>
			<h2>{number(s.reviewsThisYear)} {s.reviewsThisYear === 1 ? 'review' : 'reviews'} in the last year</h2>
			<ActivityMap days={s.days} />
		</section>

		<section class="figures">
			<div><strong>{number(s.prs)}</strong><span>pull requests</span></div>
			<div><strong>{number(s.rounds)}</strong><span>rounds reviewed</span></div>
			<div><strong>{number(s.lines)}</strong><span>lines read</span></div>
			<div>
				<strong>{number(s.posted.yours + s.posted.panel)}</strong><span>comments posted</span>
				<small class="faint">{number(s.posted.yours)} yours · {number(s.posted.panel)} from the panel</small>
			</div>
		</section>

		{#if s.reviewability.rounds.length}
			{@const sorted = s.reviewability.rounds.map((r) => r.lines)}
			{@const most = sorted[Math.floor(sorted.length * 0.9)] ?? sorted.at(-1) ?? 1}
			<section>
				<h2>What slicing does</h2>
				<p class="lede">
					A PR averaged <strong>{number(s.reviewability.pr)}</strong> changed lines. A slice of it averaged
					<strong>{number(s.reviewability.slice)}</strong>.
				</p>
				<div class="sizes" role="img" aria-label="Each round's changed lines, with its average slice">
					{#each s.reviewability.rounds as r, i (i)}
						<span class="pair" title="{r.title}, round {r.round}: {number(r.lines)} lines in {r.slices} {r.slices === 1 ? 'slice' : 'slices'} of about {number(r.slice)}">
							<span class="bar pr" class:over={r.lines > most} style:height="{height(r.lines, most)}%"></span>
							<span class="bar slice" style:height="{height(r.slice, most)}%"></span>
						</span>
					{/each}
				</div>
				<div class="key faint"><span class="swatch pr"></span>The round’s changed lines <span class="swatch slice"></span>Its average slice</div>
			</section>
		{/if}

		{#if s.reviewers.length}
			<section>
				<h2>The panel</h2>
				<ul class="reviewers">
					{#each s.reviewers as r (r.name)}
						{@const decided = r.kept + r.skipped}
						{@const open = r.raised - decided - r.filtered}
						<li>
							<span class="name">{r.name}</span>
							<span class="count faint">{number(r.raised)} {r.raised === 1 ? 'finding' : 'findings'}</span>
							<span class="split" title="{r.kept} kept · {r.skipped} skipped · {r.filtered} filtered · {open} undecided">
								<span class="kept" style:flex={r.kept}></span>
								<span class="skipped" style:flex={r.skipped}></span>
								<span class="filtered" style:flex={r.filtered}></span>
								<span class="open" style:flex={open}></span>
							</span>
							<span class="rate">{pct(r.kept, decided)} kept</span>
						</li>
					{/each}
				</ul>
				<div class="key faint">
					<span class="swatch kept"></span>Kept <span class="swatch skipped"></span>Skipped <span class="swatch filtered"></span>Filtered by the editor
					<span class="swatch open"></span>Undecided
				</div>
			</section>
		{/if}

		<section class="tidbits">
			<div><strong>{number(s.tidbits.questions)}</strong><span>questions asked</span></div>
			<div><strong>{number(s.tidbits.comments)}</strong><span>comments written</span></div>
			<div><strong>{number(s.tidbits.conclusions)}</strong><span>conclusions drawn</span></div>
			<div><strong>{number(s.tidbits.calls)}</strong><span>model calls</span></div>
			<div><strong>{number(s.tidbits.checks)}</strong><span>threads checked</span></div>
			<div><strong>{number(s.tidbits.resolved)}</strong><span>threads resolved</span></div>
			<div><strong>{number(s.tidbits.streak)}</strong><span>{s.tidbits.streak === 1 ? 'day' : 'days'} in a row, at most</span></div>
			<div><strong>{s.tidbits.severity ?? '–'}</strong><span>most common finding</span></div>
		</section>
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
	.head {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.back {
		font-size: 13.5px;
		text-decoration: none;
	}
	.back:hover {
		color: var(--text);
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
	.figures,
	.tidbits {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.figures div,
	.tidbits div {
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
	.tidbits strong {
		font-size: 20px;
		font-weight: 500;
		text-transform: capitalize;
	}
	.figures span,
	.tidbits span {
		color: var(--muted);
		font-size: 13.5px;
	}
	small {
		margin-top: 4px;
		font-size: 12px;
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
	.sizes {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 120px;
		padding: 12px 14px 0;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		overflow-x: auto;
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
	/* Bigger than the scale shows. */
	.bar.pr.over {
		border-radius: 0;
		background: linear-gradient(to bottom, transparent, var(--line-2) 14px);
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
		grid-template-columns: 160px 100px minmax(0, 1fr) 80px;
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
	.skipped,
	.swatch.skipped {
		background: #a87670;
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
		.figures,
		.tidbits {
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
