<script lang="ts">
	import SiteHeader from '$lib/ui/SiteHeader.svelte';
	import { readOk } from '$lib/api/client';
	import OverlapMap from '$lib/features/stats/OverlapMap.svelte';
	import ThemesPie from '$lib/features/stats/ThemesPie.svelte';
	import GapReport from '$lib/features/stats/GapReport.svelte';
	import type { Analysis, Stats } from '$lib/features/stats/stats';
	import { summarise } from '$lib/features/stats/summary';
	import Spinner from '$lib/ui/Spinner.svelte';
	import { shortDate } from '$lib/ui/format';

	// What reviewing has come to, at a glance: when, how much, how the slices
	// cut it down, and how the panel's findings fared.
	let stats = $state<Stats | null>(null);
	let error = $state<string | null>(null);
	fetch('/api/stats')
		.then((res) => readOk<Stats>(res))
		.then((s) => (stats = s))
		.catch((err) => (error = (err as Error).message));

	const s = $derived(stats ? summarise(stats) : null);
	// When the first counted round was worked on.
	const since = $derived.by(() => {
		const times = (stats?.rounds ?? []).flatMap((r) => [...r.activity, r.posted ?? 0, r.completed ?? 0]).filter((t) => t > 0);
		return times.length ? Math.min(...times) : null;
	});

	// The analysis of how the panel performs, run on asking; while it runs,
	// checked on every couple of seconds.
	let analysis = $state<Analysis | null>(null);
	let analysisError = $state<string | null>(null);
	async function readAnalysis(method = 'GET') {
		try {
			analysis = await readOk<Analysis>(await fetch('/api/stats/analysis', { method }));
			analysisError = null;
		} catch (err) {
			analysisError = (err as Error).message;
		}
		if (analysis?.status.running) setTimeout(readAnalysis, 2000);
	}
	readAnalysis();
	async function reset() {
		if (!confirm('Reset the analyses? The next run goes over every finding and pull request again, which takes a while and costs model calls.')) return;
		const res = await fetch('/api/stats/analysis', { method: 'DELETE' });
		if (!res.ok) analysisError = await res.text();
		await readAnalysis();
	}
	const analysed = $derived(!!analysis && (Object.keys(analysis.themes.overall).length > 0 || Object.keys(analysis.gaps.byTheme).length > 0));
	const number = (n: number) => n.toLocaleString();
	const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
	// The scale: four even steps of a round size, the last at about the
	// biggest PR, just under or past it.
	const step = (most: number) => {
		const unit = 10 ** Math.floor(Math.log10(most / 4));
		return [1, 1.5, 2, 2.5, 5, 10].map((m) => m * unit).find((m) => m * 4 >= most * 0.9) ?? unit * 10;
	};
	const ticks = (most: number) => [1, 2, 3, 4].map((i) => i * step(most));
	const height = (n: number, top: number) => (n > 0 ? Math.max(2, (n / top) * 100) : 0);
	// The bar pointed at, and where, for the card beside the cursor.
	let pointed = $state<{ index: number; x: number; y: number; flip: boolean } | null>(null);
	function point(e: PointerEvent, index: number) {
		const box = (e.currentTarget as HTMLElement).closest('.chart')!.getBoundingClientRect();
		const x = e.clientX - box.left;
		pointed = { index, x, y: e.clientY - box.top, flip: x > box.width - 240 };
	}
	const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${n}`);
</script>

<svelte:head><title>Stats · Docent</title></svelte:head>

<SiteHeader />

<main>
	<div class="head">
		<h1>Stats</h1>
		{#if since}<p class="faint since">Since {shortDate(since)}</p>{/if}
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
			{@const most = Math.max(1, ...s.reviewability.prs.map((p) => p.size))}
			{@const top = Math.max(most, step(most) * 4)}
			<section>
				<h2>Slice and dice</h2>
				<p class="lede">
					Pull requests averaged <strong>{number(s.reviewability.pr)}</strong> lines across
					<strong>{number(s.reviewability.files)}</strong> files. The average slice was
					<strong>{number(s.reviewability.slice)}</strong> lines and covered
					<strong>{s.reviewability.sliceFiles.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong> files.
				</p>
				<div class="chart">
					<div class="axis faint" aria-hidden="true">
						{#each ticks(most) as t (t)}<span style:bottom="{height(t, top)}%">{short(t)}</span>{/each}
					</div>
					<div class="sizes" role="img" aria-label="Each pull request's size, with its average slice">
						{#each ticks(most) as t (t)}<span class="grid" style:bottom="{height(t, top)}%"></span>{/each}
						{#each s.reviewability.prs as p, i (i)}
							<span
								class="pair"
								class:dim={pointed && pointed.index !== i}
								role="presentation"
								onpointermove={(e) => point(e, i)}
								onpointerleave={() => (pointed = null)}
							>
								<span class="bar pr" style:height="{height(p.size, top)}%"></span>
								<span class="bar slice" style:height="{height(p.slice, top)}%"></span>
							</span>
						{/each}
					</div>
					{#if pointed}
						{@const p = s.reviewability.prs[pointed.index]}
						<dl class="card" class:flip={pointed.flip} style:left="{pointed.x}px" style:top="{pointed.y}px">
							<dt class="title">{p.title}</dt>
							<dd></dd>
							<dt>Lines</dt>
							<dd>{number(p.size)}</dd>
							{#if p.lines !== p.size}
								<dt>Read across rounds</dt>
								<dd>{number(p.lines)}</dd>
							{/if}
							<dt>Files</dt>
							<dd>{number(p.files)}</dd>
							{#if p.rounds > 1}
								<dt>Rounds</dt>
								<dd>{p.rounds}</dd>
								<dt>Slices per round</dt>
								<dd>{(p.slices / p.rounds).toLocaleString(undefined, { maximumFractionDigits: 1 })}</dd>
							{:else}
								<dt>Slices</dt>
								<dd>{p.slices}</dd>
							{/if}
							<dt>Average slice</dt>
							<dd>{number(p.slice)}</dd>
							<dt>Largest slice</dt>
							<dd>{number(p.largest)}</dd>
						</dl>
					{/if}
				</div>
				<div class="key faint"><span class="swatch pr"></span>Lines in the pull request <span class="swatch slice"></span>Its average slice</div>
			</section>
		{/if}

		{#if s.reviewers.length}
			<section>
				<div class="row">
					<h2>Reviewers</h2>
					{#if analysis}
						<button class="btn" disabled={analysis.status.running} onclick={() => readAnalysis('POST')}>Analyse reviewer performance</button>
					{/if}
				</div>
				{#if analysis?.status.running}
					<p class="faint loading">
						<Spinner size={14} />
						{analysis.status.phase === 'gaps' ? 'Checking what others said' : 'Sorting findings into themes'}… {analysis.status.done} of {analysis.status.total}
						{analysis.status.phase === 'gaps' ? 'pull requests' : 'findings'}
					</p>
				{:else if analysisError || analysis?.status.error}
					<p class="bad">Couldn’t analyse: {analysisError ?? analysis?.status.error}</p>
				{:else if analysis && analysed && analysis.pending.findings}
					<p class="faint">{number(analysis.pending.findings)} findings since the last analysis.</p>
				{/if}
				<ul class="reviewers">
					{#each s.reviewers as r (r.id)}
						<li>
							<span class="name">{r.name}</span>
							<span class="count faint">{number(r.raised)} {r.raised === 1 ? 'finding' : 'findings'}</span>
							<span class="split" title="{r.kept} kept · {r.asSuggested} skipped as suggested · {r.filtered} filtered · {r.kickedBack} kicked back">
								<span class="kept" style:flex={r.kept}></span>
								<span class="suggested" style:flex={r.asSuggested}></span>
								<span class="filtered" style:flex={r.filtered}></span>
								<span class="kicked" style:flex={r.kickedBack}></span>
							</span>
							<span class="rate">{pct(r.kickedBack, r.kept + r.kickedBack)} kicked back</span>
						</li>
					{/each}
				</ul>
				<div class="key faint">
					<span class="swatch kept"></span>Kept <span class="swatch suggested"></span>Skipped as suggested
					<span class="swatch filtered"></span>Filtered by the editor <span class="swatch kicked"></span>Kicked back by you
				</div>
				{#if s.overlap.reviewers.length > 1}
					<h3>Reviewer alignment</h3>
					<OverlapMap reviewers={s.overlap.reviewers} pairs={s.overlap.pairs} themes={analysis?.themes.byReviewer} />
				{/if}
				{#if analysis && Object.keys(analysis.themes.overall).length}
					<h3>What the kept findings were about</h3>
					<ThemesPie counts={analysis.themes.overall} />
				{/if}
			</section>
		{/if}

		{#if analysis && Object.keys(analysis.gaps.byTheme).length}
			<section>
				<h2>Panel and others, by theme</h2>
				<GapReport gaps={analysis.gaps} kept={analysis.themes.overall} />
			</section>
		{/if}

		{#if analysed && !analysis?.status.running}
			<footer>
				<button class="reset" onclick={reset}>Reset analyses</button>
				<span class="faint">The next run then goes over everything again: long, and costly.</span>
			</footer>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 32px 24px 96px;
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
	/* A part of a section, apart from what's above it. */
	h3 {
		margin: 14px 0 0;
		font-family: var(--serif);
		font-size: 17px;
		font-weight: 500;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	footer {
		display: flex;
		align-items: baseline;
		gap: 12px;
		font-size: 12.5px;
	}
	.reset {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.reset:hover {
		color: var(--danger);
	}
	.since {
		margin: -16px 0 0;
		font-size: 14px;
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
		position: relative;
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
	.pair {
		transition: opacity 100ms;
	}
	.pair.dim {
		opacity: 0.4;
	}
	/* What a bar is, beside the cursor; on its left near the chart's right edge. */
	.card {
		position: absolute;
		z-index: 2;
		display: grid;
		grid-template-columns: auto auto;
		gap: 4px 18px;
		width: max-content;
		max-width: 260px;
		margin: 0;
		padding: 10px 12px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--surface) 94%, transparent);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			var(--shadow-small);
		font-size: 12.5px;
		transform: translate(14px, 14px);
		pointer-events: none;
	}
	.card.flip {
		transform: translate(calc(-100% - 14px), 14px);
	}
	.card dt {
		color: var(--muted);
	}
	.card dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.card .title {
		grid-column: 1 / -1;
		color: var(--text);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.card .title + dd {
		display: none;
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
		background: var(--state-done);
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
		background: var(--state-done);
	}
	.kicked,
	.swatch.kicked {
		background: var(--minus-dull);
	}
	/* Skipped as its reviewer suggested, or filtered by the editor: the
	   tools doing their job, so green too, deepening as it goes. */
	.suggested,
	.swatch.suggested {
		background: #627566;
	}
	.filtered,
	.swatch.filtered {
		background: #44534a;
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
