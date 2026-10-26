<script lang="ts">
	import { goto } from '$app/navigation';
	import GroupHeading from '$lib/features/start/GroupHeading.svelte';
	import SiteHeader from '$lib/ui/SiteHeader.svelte';
	import ReviewRow from '$lib/features/start/ReviewRow.svelte';
	import SetupDialog from '$lib/features/start/SetupDialog.svelte';
	import ThreadsDialog from '$lib/features/start/ThreadsDialog.svelte';
	import { keyOf, StartPage, type Row } from '$lib/features/start/startPage.svelte';
	import Disclosure from '$lib/ui/Disclosure.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { parsePrUrl } from '$lib/ui/format';

	// Opening a PR by its link, and the reviews and PRs you're part of below.
	const page = new StartPage();

	let url = $state('');
	let formError = $state<string | null>(null);
	let showDone = $state(false);
	let showHidden = $state(false);

	function open(e: SubmitEvent) {
		e.preventDefault();
		const ref = parsePrUrl(url);
		if (!ref) {
			formError = 'Enter a GitHub PR link, like https://github.com/owner/repo/pull/123';
			return;
		}
		goto(`/pr/${ref.owner}/${ref.repo}/${ref.number}`);
	}
</script>

<svelte:head><title>Docent</title></svelte:head>

{#if page.checked && !page.ready && !page.setupSeen}
	<SetupDialog {page} onclose={() => page.dismissSetup()} />
{/if}

{#if page.threadsOpen}
	{@const pr = page.threadsOpen}
	<ThreadsDialog {pr} title={pr.record.title ?? `#${pr.number}`} onunresolved={(n) => page.setUnresolved(pr, n)} onclose={() => (page.threadsOpen = null)} />
{/if}

<!-- A list in its groups. Each section folds its groups on its own, and a
     dimmed one dims its rows but not their headings. -->
{#snippet groups(list: Row[], section: string, dim = false, quiet = false)}
	{#each page.grouped(list) as group (group.label)}
		{@const key = `${section}:${page.sort}:${group.label}`}
		{#if group.label}
			<GroupHeading
				label={group.label}
				count={group.items.length}
				byRepo={page.sort === 'repo'}
				folded={page.collapsed.includes(key)}
				ontoggle={() => page.toggleGroup(key)}
			/>
		{/if}
		{#if !group.label || !page.collapsed.includes(key)}
			<ul class:done-list={dim} class="indent-{group.label ? page.sort : 'none'}">
				{#each group.items as pr (keyOf(pr))}<ReviewRow {pr} {page} {quiet} />{/each}
			</ul>
		{/if}
	{/each}
{/snippet}

<SiteHeader />

<div class="page">
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
			{#if page.checked && !page.ready}
				{@const needs = [!page.gh?.login && 'the GitHub CLI signed in', !page.modelSources?.length && 'a model'].filter(Boolean)}
				<p class="setup">Docent needs {needs.join(' and ')} first. <a href="/getting-started">Getting started</a> shows how.</p>
			{/if}
		</form>

		{#if page.pinned.length || page.active.length || page.mine.length || page.done.length || page.hiddenRows.length}
			<!-- How every list below is grouped. -->
			<div class="list-tools">
				<div class="grouping">
					<span class="faint">Group by</span>
					<Segmented
						small
						label="Group by"
						value={page.sort}
						onchange={(value) => page.setSort(value)}
						options={[
							{ value: 'none', label: 'None' },
							{ value: 'repo', label: 'Repo' },
							{ value: 'author', label: 'Author' }
						]}
					/>
				</div>
			</div>
		{/if}

		{#if page.pinned.length}
			<section aria-labelledby="pinned-heading">
				<h2 id="pinned-heading" class="caps">Pinned</h2>
				{@render groups(page.pinned, 'pinned')}
			</section>
		{/if}

		{#if page.active.length}
			<section aria-labelledby="saved-heading">
				<h2 id="saved-heading" class="caps">Your reviews</h2>
				{@render groups(page.active, 'reviews')}
			</section>
		{/if}

		{#if page.mine.length}
			<section aria-labelledby="mine-heading">
				<h2 id="mine-heading" class="caps">My pull requests</h2>
				{@render groups(page.mine, 'mine')}
			</section>
		{/if}

		{#if page.done.length}
			<section>
				<Disclosure bind:open={showDone} label="Done" count={page.done.length} />
				{#if showDone}{@render groups(page.done, 'complete', true, true)}{/if}
			</section>
		{/if}

		{#if page.hiddenRows.length}
			<section>
				<Disclosure bind:open={showHidden} label="Hidden" count={page.hiddenRows.length} />
				{#if showHidden}{@render groups(page.hiddenRows, 'hidden', true)}{/if}
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
	.list-tools {
		display: flex;
		justify-content: flex-end;
		margin-bottom: -28px;
	}
	/* A group's rows start where its name does, after the repo's icon or the
	   author's avatar, so the heading reads as a heading. */
	.indent-repo {
		padding-left: 21px;
	}
	.indent-author {
		padding-left: 25px;
	}
	.done-list {
		opacity: 0.7;
	}
	.page {
		position: relative;
		min-height: 100vh;
		padding: 0 24px;
	}
	.setup {
		margin: 0;
		color: var(--agent-text);
		font-size: 14px;
	}
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: calc(18vh - 64px) 0 80px;
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
</style>
