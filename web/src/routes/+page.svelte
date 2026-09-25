<script lang="ts">
	import { goto } from '$app/navigation';
	import * as api from '$lib/api';
	import { ask } from '$lib/confirm.svelte';
	import InlineText from '$lib/components/InlineText.svelte';
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

	// Open PRs you're part of on GitHub - asked to review, reviewed, or wrote -
	// refreshed on load and every few minutes. They're always listed; ones not
	// opened in Docent yet read as New.
	interface InvolvedPr extends PrRef {
		title: string;
		author?: string;
		updatedAt: string;
		createdAt: string;
		isDraft: boolean;
		decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
		reviews: { state: string; author?: string }[];
		mine: boolean;
	}
	let involved = $state<InvolvedPr[]>([]);
	function loadInvolved() {
		fetch('/api/involved-prs')
			.then((res) => api.readOk<{ prs: InvolvedPr[] }>(res))
			.then((r) => (involved = r.prs))
			.catch(() => {});
	}
	$effect(() => {
		loadInvolved();
		const every = setInterval(loadInvolved, 5 * 60_000);
		return () => clearInterval(every);
	});

	// A row on the page: a saved review, or a PR you're part of that Docent
	// hasn't opened yet.
	type Row = SavedPr & { unsaved?: boolean };
	const involvedOf = (pr: PrRef) => involved.find((i) => keyOf(i) === keyOf(pr));
	const rows = $derived.by((): Row[] => {
		const list: Row[] = [...(saved ?? [])];
		for (const i of involved) {
			if (list.some((r) => keyOf(r) === keyOf(i))) continue;
			list.push({ owner: i.owner, repo: i.repo, number: i.number, record: { ...normalize({}), title: i.title, author: i.author }, unsaved: true });
		}
		return list;
	});

	function reviewState(r: InvolvedPr): string {
		const draft = r.isDraft ? 'Draft · ' : '';
		if (r.decision === 'APPROVED') return `${draft}Approved`;
		if (r.decision === 'CHANGES_REQUESTED') return `${draft}Changes requested`;
		const by = [...new Set(r.reviews.map((v) => v.author).filter(Boolean))];
		if (!by.length) return `${draft}No reviews yet`;
		return `${draft}Reviewed by ${by.slice(0, 2).join(', ')}${by.length > 2 ? ` and ${by.length - 2} more` : ''}`;
	}

	// How Your reviews are ordered, kept in this browser.
	type Sort = 'none' | 'repo' | 'author';
	let sort = $state<Sort>(readSort());
	function readSort(): Sort {
		try {
			const value = localStorage.getItem('docent.sort');
			return value === 'repo' || value === 'author' ? value : 'none';
		} catch {
			return 'none';
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
	const isMine = (pr: SavedPr) => !!involvedOf(pr)?.mine || (!!login && authorOf(pr) === login);

	const notComplete = $derived(rows.filter((pr) => !pr.record.completedAt && !isHidden(pr)));
	const active = $derived(notComplete.filter((pr) => !isMine(pr)));
	const mine = $derived(notComplete.filter(isMine));
	// Old PRs that can't be closed can be hidden: they leave the lists above
	// for a section of their own. Kept in Docent's settings.
	let hiddenKeys = $state<string[]>([]);
	$effect(() => {
		fetch('/api/hidden-prs')
			.then((res) => api.readOk<{ hidden: string[] }>(res))
			.then((r) => (hiddenKeys = r.hidden))
			.catch(() => {});
	});
	const isHidden = (pr: PrRef) => hiddenKeys.includes(keyOf(pr));
	async function setHidden(pr: PrRef, hidden: boolean) {
		hiddenKeys = hidden ? [...hiddenKeys, keyOf(pr)] : hiddenKeys.filter((k) => k !== keyOf(pr));
		const res = await fetch('/api/hidden-prs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ owner: pr.owner, repo: pr.repo, number: pr.number, hidden })
		}).catch(() => null);
		if (res?.ok) hiddenKeys = (await res.json()).hidden;
	}
	let showHidden = $state(false);
	const hiddenRows = $derived(rows.filter(isHidden));
	const complete = $derived((saved ?? []).filter((pr) => pr.record.completedAt && !isHidden(pr)));

	// Repo and author groups folded away, kept in this browser.
	let collapsed = $state<string[]>(readCollapsed());
	function readCollapsed(): string[] {
		try {
			return JSON.parse(localStorage.getItem('docent.collapsedGroups') ?? '[]');
		} catch {
			return [];
		}
	}
	function toggleGroup(key: string) {
		collapsed = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key];
		try {
			localStorage.setItem('docent.collapsedGroups', JSON.stringify(collapsed));
		} catch {
			// Remembering it is a nicety.
		}
	}
	// A list in groups: one group by recency, else one per repo or author.
	// Oldest first throughout: the longest-waiting PRs are cleared first.
	function grouped<T extends PrRef>(list: T[], authorOf: (item: T) => string | undefined, raised: (item: T) => number) {
		list = [...list].sort((a, b) => raised(a) - raised(b));
		if (sort === 'none') return [{ label: '', items: list }];
		const labelOf = (item: T) => (sort === 'repo' ? `${item.owner}/${item.repo}` : (authorOf(item) ?? 'Author not known yet'));
		const byLabel = new Map<string, T[]>();
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
			const { slices, conversation, summary, fileNotes, head } = generation.results;
			if (slices || conversation || summary || fileNotes) {
				await updateRecord(ref, (r) => {
					if (slices) r.slices = slices;
					if (slices && head) r.preparedHead = head;
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
		loadStatuses(list);
		generations = listed.filter(({ generation }) => generation.status !== 'done');
	}

	$effect(() => {
		refresh();
	});

	// Where each saved PR stands on GitHub now: its author, when it was
	// raised, and its head commit, to tell which have had new commits since
	// they were prepared. Checked on load and every few minutes.
	interface PrStatus extends PrRef {
		head: string;
		createdAt: string;
		author?: string;
		state: 'OPEN' | 'CLOSED' | 'MERGED';
	}
	let statuses = $state<Record<string, PrStatus>>({});
	let statusesAt = 0;
	function loadStatuses(list: SavedPr[], force = false) {
		if (!list.length || (!force && Date.now() - statusesAt < 5 * 60_000)) return;
		statusesAt = Date.now();
		fetch('/api/pr-statuses', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prs: list.map(({ owner, repo, number }) => ({ owner, repo, number })) })
		})
			.then((res) => api.readOk<{ statuses: PrStatus[] }>(res))
			.then((r) => (statuses = Object.fromEntries(r.statuses.map((st) => [keyOf(st), st]))))
			.catch(() => {});
	}
	$effect(() => {
		const every = setInterval(() => saved && loadStatuses(saved, true), 5 * 60_000);
		return () => clearInterval(every);
	});
	const authorOf = (pr: SavedPr) => pr.record.author ?? statuses[keyOf(pr)]?.author ?? involvedOf(pr)?.author;
	const raisedAt = (pr: SavedPr) => Date.parse(statuses[keyOf(pr)]?.createdAt ?? involvedOf(pr)?.createdAt ?? '') || 0;
	// New commits since the slices were made.
	const updatedSince = (pr: SavedPr) => {
		const now = statuses[keyOf(pr)]?.head;
		return !!pr.record.preparedHead && !!now && now !== pr.record.preparedHead;
	};

	// Where a review stands, as one of a few states.
	function stateOf(pr: Row): { label: string; tone: 'new' | 'working' | 'ready' | 'going' | 'done' | 'bad' | 'quiet' } {
		if (pr.unsaved) return { label: 'New', tone: 'new' };
		const generation = generationFor(pr);
		if (generation?.status === 'queued') return { label: 'Queued', tone: 'quiet' };
		if (isGenerating(generation) && generation?.steps.summary.status !== 'done') return { label: 'Preparing', tone: 'working' };
		if (generation?.status === 'failed') return { label: 'Preparing failed', tone: 'bad' };
		if (generation?.status === 'stopped' && !pr.record.summary) return { label: 'Stopped', tone: 'quiet' };
		if (pr.record.completedAt) return { label: 'Complete', tone: 'done' };
		if (pr.record.review?.posted) return { label: 'Posted', tone: 'done' };
		if (panelFor(pr)?.running) return { label: 'Reviewing', tone: 'working' };
		const { done, total } = progress(pr);
		if (total && done === total) return { label: 'Read', tone: 'going' };
		if (done > 0) return { label: 'In progress', tone: 'going' };
		if (pr.record.summary || total) return { label: 'Ready', tone: 'ready' };
		return { label: 'Not prepared', tone: 'quiet' };
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

		{#snippet reviewRow(pr: Row)}
			{@const standing = stateOf(pr)}
			<li>
				<a href="/pr/{pr.owner}/{pr.repo}/{pr.number}">
					<span class="text">
						<span class="title"><InlineText text={pr.record.title ?? `#${pr.number}`} /></span>
						<span class="faint meta">
							{pr.owner}/{pr.repo} #{pr.number}{authorOf(pr) ? ` · by ${authorOf(pr)}` : ''}{raisedAt(pr)
									? ` · raised ${timeAgo(raisedAt(pr), now)}`
									: ''}
							{#if involvedOf(pr) && (pr.unsaved || !pr.record.review?.posted)}· {reviewState(involvedOf(pr)!)}{/if}
							{#if panelFor(pr)?.findings && !panelFor(pr)?.running}
								· {panelFor(pr)!.findings} {panelFor(pr)!.findings === 1 ? 'finding' : 'findings'}
							{/if}
						</span>
					</span>
					<span class="state">
						{#if updatedSince(pr)}<span class="updated" title="The PR has new commits since Docent prepared it">Updated since</span>{/if}
						<span class="status-label {standing.tone}">
							{#if standing.tone === 'working'}<Spinner size={11} />{:else}<span class="dot" aria-hidden="true"></span>{/if}
							{standing.label}
						</span>
					</span>
				</a>
				<span class="row-actions">
					<button class="icon" aria-label={isHidden(pr) ? 'Show in the lists again' : 'Hide'} title={isHidden(pr) ? 'Show in the lists again' : 'Hide'} onclick={() => setHidden(pr, !isHidden(pr))}>
						{#if isHidden(pr)}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-2.9 3.9M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
						{/if}
					</button>
					{#if !pr.unsaved}<button class="icon" aria-label="Delete this review" title="Delete this review" onclick={() => remove(pr)}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg
						>
					</button>{/if}
				</span>
			</li>
		{/snippet}

		{#if active.length || mine.length}
			<!-- How every list below is ordered. -->
			<div class="list-tools">{@render viewMenu()}</div>
		{/if}


		<!-- A repo links to its pull requests on GitHub; an author shows their avatar. -->
		{#snippet groupHeading(label: string, count: number, key: string)}
			<h3 class="group">
				{#if sort === 'repo'}
					<a class="group-link" href="https://github.com/{label}/pulls" target="_blank" rel="noreferrer" title="{label}’s pull requests on GitHub">
						<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
							><path
								fill="currentColor"
								d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
							/></svg
						>
						{label}
					</a>
				{:else if label !== 'Author not known yet'}
					<img class="avatar" src="https://github.com/{label}.png?size=48" alt="" width="20" height="20" loading="lazy" />
					{label}
				{:else}
					{label}
				{/if}
				<span class="count">{count}</span>
				<button class="fold" aria-expanded={!collapsed.includes(key)} aria-label="{collapsed.includes(key) ? 'Show' : 'Fold'} {label}" onclick={() => toggleGroup(key)}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={collapsed.includes(key) ? '' : 'rotate(90deg)'}><path d="M9 6l6 6-6 6" /></svg>
				</button>
			</h3>
		{/snippet}

		{#snippet viewMenu()}
			<div class="grouping" role="group" aria-label="Group by">
				<span class="faint">Group by</span>
				<div class="segments">
					{#each [['none', 'None'], ['repo', 'Repo'], ['author', 'Author']] as [value, label] (value)}
						<button class:on={sort === value} aria-pressed={sort === value} onclick={() => setSort(value as Sort)}>{label}</button>
					{/each}
				</div>
			</div>
		{/snippet}

		{#snippet groups(list: Row[])}
			{#each grouped(list, authorOf, raisedAt) as group (group.label)}
				{@const key = `${sort}:${group.label}`}
				{#if group.label}{@render groupHeading(group.label, group.items.length, key)}{/if}
				{#if !group.label || !collapsed.includes(key)}
					<ul>
						{#each group.items as pr (keyOf(pr))}{@render reviewRow(pr)}{/each}
					</ul>
				{/if}
			{/each}
		{/snippet}

		{#if active.length}
			<section aria-labelledby="saved-heading">
				<div class="section-head">
					<h2 id="saved-heading" class="caps">Your reviews</h2>
				</div>
				{@render groups(active)}
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
					Complete <span class="count">({complete.length})</span>
				</button>
				{#if showComplete}
					<ul class="done-list">
						{#each complete as pr (keyOf(pr))}{@render reviewRow(pr)}{/each}
					</ul>
				{/if}
			</section>
		{/if}

		{#if hiddenRows.length}
			<section>
				<button class="fold-head" aria-expanded={showHidden} onclick={() => (showHidden = !showHidden)}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showHidden ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
					Hidden <span class="count">({hiddenRows.length})</span>
				</button>
				{#if showHidden}
					<ul class="done-list">
						{#each hiddenRows as pr (keyOf(pr))}{@render reviewRow(pr)}{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</main>
</div>

<style>
	.grouping {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.segments {
		display: flex;
		padding: 2px;
		border-radius: 9px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.segments button {
		height: 26px;
		padding: 0 11px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		cursor: pointer;
	}
	.segments button:hover {
		color: var(--text);
	}
	.segments button.on {
		background: #ece8df;
		color: #141413;
	}
	/* The state as a badge, tinted in its colour. */
	.status-label {
		--tone: var(--muted);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px 3px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--tone) 16%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 28%, transparent);
		color: var(--tone);
		font-size: 12.5px;
		font-weight: 500;
		white-space: nowrap;
	}
	.status-label .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.status-label.new {
		--tone: #c8a8ff;
	}
	.status-label.working {
		--tone: #ffb85c;
	}
	.status-label.ready {
		--tone: #8ab4ff;
	}
	.status-label.going {
		--tone: #e8e2d6;
	}
	.status-label.done {
		--tone: #7fd89b;
	}
	.status-label.bad {
		--tone: #ff8a7a;
	}
	.status-label.quiet {
		--tone: var(--faint);
	}
	.updated {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--agent-chip);
		color: var(--agent-text);
		font-size: 12px;
		white-space: nowrap;
	}
	.list-tools {
		display: flex;
		justify-content: flex-end;
		margin-bottom: -28px;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	/* A heading per repo or author: the repo's GitHub link, or the author's avatar. */
	.group {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 26px 0 8px;
		font-size: 14px;
		font-weight: 500;
		color: var(--text);
	}
	.group-link {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: inherit;
		text-decoration: none;
	}
	.group-link svg {
		color: var(--muted);
	}
	.group-link:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.avatar {
		border-radius: 50%;
		background: var(--surface-2);
	}
	.group .count {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 400;
		color: var(--faint);
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
		padding: 16px 4px;
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
	/* Float just outside the row, so the states line up at its edge. */
	.row-actions {
		position: absolute;
		left: calc(100% + 6px);
		display: flex;
		gap: 2px;
		opacity: 0;
	}
	li:hover .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}
	.fold {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		margin-left: -2px;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--faint);
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
	}
</style>
