<script lang="ts">
	import InlineText from '$lib/ui/InlineText.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import { timeAgo } from '$lib/ui/format';
	import type { Row, StartPage } from './startPage.svelte';

	// One PR on the start page: a dot when something's new since you last
	// opened it, its title and where it's from; then where the round it opens
	// stands, a line on what's next, and its rounds along its commits.
	let { pr, page }: { pr: Row; page: StartPage } = $props();

	const view = $derived(page.rowOf(pr));
	const changes = $derived(page.changesSince(pr));
	const author = $derived(page.authorOf(pr));
	const raised = $derived(page.raisedAt(pr));
	const hidden = $derived(page.isHidden(pr));
</script>

<li>
	<a href="/pr/{pr.owner}/{pr.repo}/{pr.number}">
		<span class="unread">
			{#if changes.length}<span class="dot" role="img" aria-label="Since you last opened it: {changes.join(', ')}" title="Since you last opened it: {changes.join(', ')}"></span>{/if}
		</span>
		<span class="text">
			<span class="title"><InlineText text={pr.record.title ?? `#${pr.number}`} /></span>
			<span class="faint meta">{pr.owner}/{pr.repo} #{pr.number}{author ? ` · ${author}` : ''}{raised ? ` · ${timeAgo(raised, page.now)}` : ''}</span>
		</span>
		<span class="state">
			<span class="status {view.tone}">{#if view.tone === 'working'}<Spinner size={11} />{/if}{view.status}</span>
			{#if view.note || view.track.length}
				<span class="under">
					{#if view.note}<span class="note" class:commits={view.noteCommits}>{view.note}</span>{/if}
					{#if view.track.length}
						<span class="track" class:dense={view.track.length > 18} aria-hidden="true">
							{#each view.track as tone, i (i)}<span class="cell {tone}"><i></i></span>{/each}
						</span>
					{/if}
				</span>
			{/if}
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
		gap: 14px;
		padding: 20px 6px 20px 2px;
		text-decoration: none;
	}
	li a:hover .title {
		color: #fff;
	}
	/* Before the title, so titles line up with or without it. */
	.unread {
		flex: none;
		align-self: flex-start;
		display: flex;
		justify-content: center;
		width: 8px;
		padding-top: 7px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--you);
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.title {
		font-size: 15px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.state {
		flex: 0 0 auto;
		max-width: 260px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
	}
	.status {
		--tone: var(--muted);
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--tone);
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
	}
	.new {
		--tone: #c8a8ff;
	}
	/* Docent busy with it: the spinner says so, so the colour stays quiet. */
	.working {
		--tone: #e8e2d6;
	}
	.ready {
		--tone: #8ab4ff;
	}
	/* You're partway through it: the one to spot. */
	.going {
		--tone: #ffb85c;
	}
	.read {
		--tone: var(--muted);
	}
	.done {
		--tone: #7fd89b;
	}
	.bad {
		--tone: #ff8a7a;
	}
	.quiet {
		--tone: var(--faint);
	}
	.under {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.note {
		font-size: 12.5px;
		color: var(--faint);
		white-space: nowrap;
	}
	.note.commits {
		color: var(--you-text);
	}
	/* Its rounds along its commits: each round's in its state's colour, a
	   pip per commit, and those no round covers yet hollow. */
	.track {
		display: flex;
		align-items: center;
		width: 112px;
		height: 10px;
	}
	.cell {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		height: 100%;
	}
	.cell::before {
		content: '';
		flex: 1 1 0;
		height: 2px;
		background: var(--tone);
	}
	.cell:first-child::before {
		background: none;
	}
	.cell i {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--tone);
	}
	.cell.working {
		--tone: #6b6d73;
	}
	.cell.out {
		--tone: var(--line-2);
	}
	.cell.fresh::before {
		background: var(--line-2);
	}
	.cell.fresh i {
		box-sizing: border-box;
		background: none;
		border: 1.5px solid var(--you);
	}
	/* Too many commits for a pip each: just the line. */
	.track.dense .cell i {
		width: 0;
		border: 0;
	}
	.track.dense .cell::before {
		height: 2px;
	}
	.track.dense .cell.fresh::before {
		background: color-mix(in srgb, var(--you) 45%, transparent);
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
