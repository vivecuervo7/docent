<script lang="ts">
	import { goto } from '$app/navigation';
	import * as api from '$lib/api';
	import { ask } from '$lib/confirm.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { parsePrUrl, timeAgo } from '$lib/format';
	import { deleteSaved, listSaved, normalize, updateRecord } from '$lib/record';
	import { isGenerating, isSliceReviewed } from '$lib/session.svelte';
	import type { Generation, PrRef, SavedPr } from '$lib/types';

	let url = $state('');
	let formError = $state<string | null>(null);
	let saved = $state<SavedPr[] | null>(null);
	let generations = $state<(PrRef & { generation: Generation })[]>([]);
	// Agent reviews running, or finished and not yet collected by the PR.
	let agentReviews = $state<(PrRef & { reviewer: string; status: string; findings: number })[]>([]);
	let now = $state(Date.now());

	// Asked for a review on GitHub, by name; refreshed on load and every few
	// minutes. Ones already opened here are under Your reviews instead.
	interface ReviewRequest extends PrRef {
		title: string;
		author?: string;
		updatedAt: string;
		isDraft: boolean;
		decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
		reviews: { state: string; author?: string }[];
	}
	let requests = $state<ReviewRequest[]>([]);
	function loadRequests() {
		fetch('/api/review-requests')
			.then((res) => api.readOk<{ requests: ReviewRequest[] }>(res))
			.then((r) => (requests = r.requests))
			.catch(() => {});
	}
	$effect(() => {
		loadRequests();
		const every = setInterval(loadRequests, 5 * 60_000);
		return () => clearInterval(every);
	});
	const waiting = $derived(requests.filter((r) => !saved?.some((s) => keyOf(s) === keyOf(r))));

	function reviewState(r: ReviewRequest): string {
		const draft = r.isDraft ? 'Draft · ' : '';
		if (r.decision === 'APPROVED') return `${draft}Approved`;
		if (r.decision === 'CHANGES_REQUESTED') return `${draft}Changes requested`;
		const by = [...new Set(r.reviews.map((v) => v.author).filter(Boolean))];
		if (!by.length) return `${draft}No reviews yet`;
		return `${draft}Reviewed by ${by.slice(0, 2).join(', ')}${by.length > 2 ? ` and ${by.length - 2} more` : ''}`;
	}

	// How Your reviews are ordered, kept in this browser.
	type Sort = 'recent' | 'repo' | 'author';
	let sort = $state<Sort>(readSort());
	function readSort(): Sort {
		try {
			const value = localStorage.getItem('docent.sort');
			return value === 'repo' || value === 'author' ? value : 'recent';
		} catch {
			return 'recent';
		}
	}
	function setSort(value: Sort) {
		sort = value;
		try {
			localStorage.setItem('docent.sort', value);
		} catch {
			// Remembering it is a nicety.
		}
	}
	let showComplete = $state(false);

	// PRs the reviewer wrote get a section of their own.
	const isMine = (pr: SavedPr) => !!login && pr.record.author === login;
	let viewOpen = $state(false);
	$effect(() => {
		if (!viewOpen) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.view')) viewOpen = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});

	const notComplete = $derived((saved ?? []).filter((pr) => !pr.record.completedAt));
	const active = $derived(notComplete.filter((pr) => !isMine(pr)));
	const mine = $derived(notComplete.filter(isMine));
	const complete = $derived((saved ?? []).filter((pr) => pr.record.completedAt));
	// A list in groups: one group by recency, else one per repo or author.
	function grouped(list: SavedPr[]) {
		if (sort === 'recent') return [{ label: '', items: list }];
		const labelOf = (pr: SavedPr) => (sort === 'repo' ? `${pr.owner}/${pr.repo}` : (pr.record.author ?? 'Author not known yet'));
		const byLabel = new Map<string, SavedPr[]>();
		for (const pr of list) byLabel.set(labelOf(pr), [...(byLabel.get(labelOf(pr)) ?? []), pr]);
		return [...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({ label, items }));
	}
	// Without a signed-in GitHub CLI nothing opens, so say where to start.
	let ghMissing = $state(false);
	// The reviewer's GitHub login, to tell their own PRs apart.
	let login = $state<string | null>(null);
	$effect(() => {
		fetch('/api/setup')
			.then((res) => api.readOk<{ gh: { login?: string } }>(res))
			.then((check) => {
				ghMissing = !check.gh.login;
				login = check.gh.login ?? null;
			})
			.catch(() => {});
	});

	const keyOf = (ref: PrRef) => `${ref.owner}/${ref.repo}/${ref.number}`;
	// Runs whose results are already saved, so each is written once.
	const collected = new Set<string>();

	// Reads saved reviews and the backend's runs together. A run that ended
	// while nobody was looking gets its results saved here; a finished one is
	// then dropped from the backend.
	async function refresh() {
		fetch('/api/agent-reviews')
			.then((res) => api.readOk<{ reviews: typeof agentReviews }>(res))
			.then(({ reviews }) => (agentReviews = reviews))
			.catch(() => {});
		const listed = await api.listGenerations().catch(() => []);
		for (const { generation, ...ref } of listed) {
			const mark = `${generation.id}:${generation.status}`;
			if (isGenerating(generation) || collected.has(mark)) continue;
			collected.add(mark);
			const { slices, conversation, summary, fileNotes } = generation.results;
			if (slices || conversation || summary || fileNotes) {
				await updateRecord(ref, (r) => {
					if (slices) r.slices = slices;
					if (conversation) r.conversation = conversation;
					if (summary) r.summary = summary;
					if (fileNotes) r.fileNotes = fileNotes;
				}).catch(() => {});
			}
			if (generation.status === 'done') await api.dismissGeneration(ref);
		}
		const list = await listSaved().catch(() => [] as SavedPr[]);
		// A run can exist for a PR with nothing saved yet.
		for (const { generation: _, ...ref } of listed) {
			if (!list.some((s) => keyOf(s) === keyOf(ref))) list.push({ ...ref, record: normalize({}) });
		}
		saved = list.sort((a, b) => (b.record.lastOpenedAt ?? 0) - (a.record.lastOpenedAt ?? 0));
		fillAuthors(list);
		generations = listed.filter(({ generation }) => generation.status !== 'done');
	}

	$effect(() => {
		refresh();
	});

	// Reviews saved before authors were kept get theirs, once each.
	const askedAuthor = new Set<string>();
	function fillAuthors(list: SavedPr[]) {
		for (const pr of list) {
			if (pr.record.author || !pr.record.title || askedAuthor.has(keyOf(pr))) continue;
			askedAuthor.add(keyOf(pr));
			api
				.fetchPr(pr)
				.then(({ meta }) => {
					const author = meta?.author;
					if (!author) return;
					return updateRecord(pr, (r) => (r.author = author)).then(() => {
						saved = (saved ?? []).map((s) => (keyOf(s) === keyOf(pr) ? { ...s, record: { ...s.record, author } } : s));
					});
				})
				.catch(() => {});
		}
	}

	const anyRunning = $derived(
		generations.some(({ generation }) => isGenerating(generation)) || agentReviews.some((r) => r.status === 'running')
	);

	// Where a PR's panel is: reviewing, or done with its findings in.
	function panelFor(pr: SavedPr): { running: number; findings: number } | null {
		const live = agentReviews.filter((r) => keyOf(r) === keyOf(pr));
		const running = live.filter((r) => r.status === 'running').length;
		const ran = live.length > 0 || pr.record.agentReviewers.some((a) => a.lastRun);
		if (!ran) return null;
		const collected = Object.entries(pr.record.feedback)
			.filter(([key]) => key.startsWith('agent-') && !live.some((r) => r.reviewer === key))
			.reduce((n, [, d]) => n + (d?.items.length ?? 0), 0);
		return { running, findings: collected + live.reduce((n, r) => n + r.findings, 0) };
	}
	$effect(() => {
		if (!anyRunning) return;
		const poll = setInterval(refresh, 2000);
		const tick = setInterval(() => (now = Date.now()), 30000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	function generationFor(pr: SavedPr): Generation | undefined {
		return generations.find((g) => keyOf(g) === keyOf(pr))?.generation;
	}

	function open(e: SubmitEvent) {
		e.preventDefault();
		const ref = parsePrUrl(url);
		if (!ref) {
			formError = 'Enter a GitHub PR link, like https://github.com/owner/repo/pull/123';
			return;
		}
		goto(`/pr/${ref.owner}/${ref.repo}/${ref.number}`);
	}

	async function remove(pr: SavedPr) {
		const title = pr.record.title ?? `#${pr.number}`;
		if (!(await ask({ title: `Delete your review of “${title}”?`, body: 'Its threads and feedback go with it.', action: 'Delete' }))) return;
		const generation = generationFor(pr);
		if (isGenerating(generation)) await api.stopGeneration(pr).catch(() => {});
		await api.dismissGeneration(pr);
		await deleteSaved(pr);
		await refresh();
	}

	// A run still going can already have its slices; they count as soon as
	// they exist.
	function progress(pr: SavedPr) {
		const slices = pr.record.slices ?? generationFor(pr)?.results.slices ?? [];
		const done = slices.filter((s) => isSliceReviewed(s, pr.record.reviewed)).length;
		return { done, total: slices.length };
	}
</script>

<svelte:head><title>Docent</title></svelte:head>

<div class="page">
	<div class="picker">
		<a class="guide faint" href="/getting-started">Getting started</a>
		<a class="guide faint" href="/settings">Settings</a>
		<ModelPicker />
	</div>

	<main>
		<form onsubmit={open}>
			<h1>Review a pull request</h1>
			<p class="faint">Paste a GitHub PR link. It’ll be broken into slices you can review one at a time.</p>
			<div class="row">
				<input
					type="url"
					bind:value={url}
					placeholder="https://github.com/owner/repo/pull/123"
					aria-label="Pull request link"
					aria-invalid={formError ? 'true' : undefined}
					oninput={() => (formError = null)}
				/>
				<button class="btn primary big" type="submit">Open</button>
			</div>
			{#if formError}<p class="error">{formError}</p>{/if}
			{#if ghMissing}
				<p class="setup">Docent can’t reach GitHub yet. <a href="/getting-started">Getting started</a> shows what to set up.</p>
			{/if}
		</form>

		{#snippet reviewRow(pr: SavedPr)}
			{@const generation = generationFor(pr)}
			{@const { done, total } = progress(pr)}
			<li>
				<a href="/pr/{pr.owner}/{pr.repo}/{pr.number}">
					<span class="text">
						<span class="title">{pr.record.title ?? `#${pr.number}`}</span>
						<span class="faint meta">
							{pr.owner}/{pr.repo} #{pr.number}{pr.record.author ? ` · by ${pr.record.author}` : ''}{pr.record.lastOpenedAt
									? ` · opened ${timeAgo(pr.record.lastOpenedAt, now)}`
									: ''}
							{#if panelFor(pr)}
								{@const p = panelFor(pr)!}
								<span class="panel" class:working={p.running}>
									·
									{#if p.running}<Spinner size={11} /> Panel reviewing{:else}Panel done{/if}{p.findings
										? ` · ${p.findings} ${p.findings === 1 ? 'finding' : 'findings'}`
										: ''}
								</span>
							{/if}
						</span>
					</span>
					{#if generation?.status === 'queued'}
						<span class="state faint">Queued</span>
					{:else if isGenerating(generation) && generation?.steps.summary.status !== 'done'}
						<span class="state working"><Spinner size={14} />Preparing</span>
					{:else if isGenerating(generation)}
						<!-- Readable now; only the file notes are still coming. -->
						<span class="state faint" title="Ready to read; notes on the tests and larger changes are still coming">
							<Spinner size={12} />
							{done} of {total} slices
						</span>
					{:else if generation?.status === 'failed'}
						<span class="state bad">Preparing failed</span>
					{:else if generation?.status === 'stopped'}
						<span class="state faint">Stopped</span>
					{:else if total > 0}
						<span class="state faint">
							<span class="bar" aria-hidden="true"><span style:width="{(done / total) * 100}%"></span></span>
							{done} of {total} slices
						</span>
					{/if}
				</a>
				<button class="icon delete" aria-label="Delete this review" onclick={() => remove(pr)}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
						><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg
					>
				</button>
			</li>
		{/snippet}

		{#if waiting.length}
			<section aria-labelledby="requests-heading">
				<h2 id="requests-heading" class="caps">Waiting for your review</h2>
				<ul>
					{#each waiting as r (keyOf(r))}
						<li>
							<a href="/pr/{r.owner}/{r.repo}/{r.number}">
								<span class="text">
									<span class="title">{r.title}</span>
									<span class="faint meta">
										{r.owner}/{r.repo} #{r.number}{r.author ? ` · by ${r.author}` : ''} · updated {timeAgo(Date.parse(r.updatedAt), now)}
									</span>
								</span>
								<span class="state faint">{reviewState(r)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#snippet groups(list: SavedPr[])}
			{#each grouped(list) as group (group.label)}
				{#if group.label}<h3 class="group">{group.label} <span class="count">{group.items.length}</span></h3>{/if}
				<ul>
					{#each group.items as pr (keyOf(pr))}{@render reviewRow(pr)}{/each}
				</ul>
			{/each}
		{/snippet}

		{#if active.length || mine.length}
			<section aria-labelledby="saved-heading">
				<div class="section-head">
					<h2 id="saved-heading" class="caps">Your reviews</h2>
					<div class="view">
						<button class="view-trigger" aria-haspopup="menu" aria-expanded={viewOpen} onclick={() => (viewOpen = !viewOpen)}>
							View
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
						</button>
						{#if viewOpen}
							<div class="view-menu" role="menu" aria-label="View">
								<span class="menu-group">Order by</span>
								{#each [['recent', 'Most recent'], ['repo', 'Repo'], ['author', 'Author']] as [value, label] (value)}
									<button role="menuitemradio" aria-checked={sort === value} onclick={() => setSort(value as Sort)}>
										<span class="tick">{#if sort === value}✓{/if}</span>
										<span>{label}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
				{#if active.length}{@render groups(active)}{:else}<p class="faint hidden-note">Nothing open for anyone else’s PRs.</p>{/if}
			</section>
		{/if}

		{#if mine.length}
			<section aria-labelledby="mine-heading">
				<h2 id="mine-heading" class="caps">My pull requests</h2>
				{@render groups(mine)}
			</section>
		{/if}

		{#if complete.length}
			<section>
				<button class="fold-head" aria-expanded={showComplete} onclick={() => (showComplete = !showComplete)}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showComplete ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
					Complete <span class="count">{complete.length}</span>
				</button>
				{#if showComplete}
					<ul class="done-list">
						{#each complete as pr (keyOf(pr))}{@render reviewRow(pr)}{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</main>
</div>

<style>
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	/* A heading per repo or author, standing clear of the rows under it. */
	.group {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 30px 0 2px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--line-2);
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}
	.group + ul > li:first-child {
		border-top: 0;
	}
	.group .count {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 400;
		color: var(--faint);
	}
	.view {
		position: relative;
	}
	.view-trigger {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.view-trigger:hover,
	.view-trigger[aria-expanded='true'] {
		color: var(--text);
		background: var(--surface-2);
	}
	.view-menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		right: 0;
		min-width: 220px;
		padding: 6px;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.menu-group {
		padding: 8px 10px 4px;
		font-size: 11px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	.view-menu button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.view-menu button:hover {
		background: var(--line-2);
	}
	.tick {
		color: var(--done);
		font-size: 13px;
	}
	.hidden-note {
		margin: 12px 0 0;
		font-size: 14px;
	}
	.fold-head {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 0;
		background: none;
		padding: 0;
		color: var(--faint);
		font: inherit;
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		cursor: pointer;
	}
	.fold-head:hover {
		color: var(--text);
	}
	.count {
		font-family: var(--mono);
		letter-spacing: 0;
	}
	.done-list {
		opacity: 0.7;
	}
	.panel {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.panel.working {
		color: var(--agent-text);
	}
	.page {
		position: relative;
		min-height: 100vh;
		padding: 0 24px;
	}
	.picker {
		position: absolute;
		top: 22px;
		right: 28px;
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.setup {
		margin: 0;
		color: var(--agent-text);
		font-size: 14px;
	}
	.guide {
		font-size: 13.5px;
		text-decoration: none;
	}
	.guide:hover {
		color: var(--text);
	}
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 18vh 0 80px;
		display: flex;
		flex-direction: column;
		gap: 56px;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h1 {
		margin: 0;
		font-family: var(--serif);
		font-weight: 500;
		font-size: 38px;
		letter-spacing: -0.015em;
	}
	form p {
		margin: 0 0 8px;
		font-size: 15px;
	}
	.row {
		display: flex;
		gap: 10px;
	}
	input {
		flex-grow: 1;
		min-width: 0;
		height: 46px;
		padding: 0 16px;
		border: 0;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 15px;
		outline: none;
	}
	input:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.big {
		height: 46px;
		padding: 0 24px;
		border-radius: 12px;
		font-size: 15px;
	}
	.error {
		margin: 0;
		font-size: 13.5px;
		color: var(--danger);
	}
	.caps {
		margin: 0 0 8px;
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		position: relative;
		display: flex;
		align-items: center;
		border-top: 1px solid var(--line);
	}
	li a {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 16px 44px 16px 4px;
		text-decoration: none;
	}
	li a:hover .title {
		color: #fff;
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.title {
		font-size: 15.5px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 13px;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		white-space: nowrap;
	}
	.state.working {
		color: var(--agent-text);
	}
	.state.bad {
		color: var(--danger);
	}
	.bar {
		display: block;
		width: 64px;
		height: 4px;
		border-radius: 2px;
		background: var(--line-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 4px;
		background: var(--done);
	}
	.delete {
		position: absolute;
		right: 4px;
		opacity: 0;
	}
	li:hover .delete,
	.delete:focus-visible {
		opacity: 1;
	}
</style>
