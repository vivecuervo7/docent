<script lang="ts">
	import InlineText from '$lib/ui/InlineText.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import { timeAgo } from '$lib/ui/format';
	import type { Row, StartPage } from './startPage.svelte';

	// One PR on the start page: its title and where it's from, where the
	// review stands, and hiding or deleting it from beside the row.
	let { pr, page }: { pr: Row; page: StartPage } = $props();

	const standing = $derived(page.stateOf(pr));
	const changes = $derived(page.changesSince(pr));
	const involved = $derived(page.involvedOf(pr));
	const panel = $derived(page.panelFor(pr));
	const author = $derived(page.authorOf(pr));
	const raised = $derived(page.raisedAt(pr));
	const hidden = $derived(page.isHidden(pr));
</script>

<li>
	<a href="/pr/{pr.owner}/{pr.repo}/{pr.number}">
		<span class="text">
			<span class="title"><InlineText text={pr.record.title ?? `#${pr.number}`} /></span>
			<span class="faint meta">
				{pr.owner}/{pr.repo} #{pr.number}{author ? ` · by ${author}` : ''}{raised ? ` · raised ${timeAgo(raised, page.now)}` : ''}
				{#if involved && (pr.unsaved || !pr.record.review?.posted)}· {page.reviewState(involved)}{/if}
				{#if panel?.findings && !panel.running}
					· {panel.findings} {panel.findings === 1 ? 'finding' : 'findings'}
				{/if}
			</span>
		</span>
		<span class="state">
			{#if page.updatedSince(pr)}<span class="updated" title="The PR has new commits since Docent prepared it">Updated since</span>{/if}
			<span class="status-label {standing.tone}" title={changes.length ? `Since you last opened it: ${changes.join(', ')}` : undefined}>
				{#if standing.tone === 'working'}<Spinner size={11} />{:else if changes.length}<span
						class="dot"
						aria-label="Since you last opened it: {changes.join(', ')}"
					></span>{/if}
				{standing.label}
			</span>
		</span>
	</a>
	<span class="row-actions">
		<button class="icon" aria-label={hidden ? 'Show in the lists again' : 'Hide'} title={hidden ? 'Show in the lists again' : 'Hide'} onclick={() => page.setHidden(pr, !hidden)}>
			{#if hidden}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-2.9 3.9M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
			{/if}
		</button>
		{#if !pr.unsaved}<button class="icon" aria-label="Delete this review" title="Delete this review" onclick={() => page.remove(pr)}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg
				>
			</button>{/if}
	</span>
</li>

<style>
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
	.updated {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--agent-chip);
		color: var(--agent-text);
		font-size: 12px;
		white-space: nowrap;
	}
	/* The state as a badge, tinted in its colour. */
	.status-label {
		--tone: var(--muted);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--tone) 16%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 28%, transparent);
		color: var(--tone);
		font-size: 12.5px;
		font-weight: 500;
		white-space: nowrap;
	}
	/* Something new since you last opened it. */
	.status-label .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.status-label.new {
		--tone: #c8a8ff;
	}
	/* Docent busy with it: the spinner says so, so the colour stays quiet. */
	.status-label.working {
		--tone: #e8e2d6;
	}
	.status-label.ready {
		--tone: #8ab4ff;
	}
	/* You're partway through it: the one to spot. */
	.status-label.going {
		--tone: #ffb85c;
	}
	.status-label.read {
		--tone: var(--muted);
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
</style>
