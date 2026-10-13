<script lang="ts">
	import { goto } from '$app/navigation';
	import InlineText from '$lib/ui/InlineText.svelte';
	import { timeAgo } from '$lib/ui/format';
	import RoundBauble from './RoundBauble.svelte';
	import type { Row, StartPage } from './startPage.svelte';

	// One PR on the start page: a dot when something's new since you last
	// opened it, its title and where it's from, and a bauble per round - each
	// opening its round, with what it holds on hover - then one for commits
	// pushed since, to review as the next round.
	let { pr, page }: { pr: Row; page: StartPage } = $props();

	const view = $derived(page.rowOf(pr));
	const changes = $derived(page.changesSince(pr));
	const author = $derived(page.authorOf(pr));
	const raised = $derived(page.raisedAt(pr));
	const hidden = $derived(page.isHidden(pr));
	const href = $derived(`/pr/${pr.owner}/${pr.repo}/${pr.number}`);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<li>
	<a class="main" {href}>
		<span class="unread">
			{#if changes.length}<span class="dot" role="img" aria-label="Since you last opened it: {changes.join(', ')}" title="Since you last opened it: {changes.join(', ')}"></span>{/if}
		</span>
		<span class="text">
			<span class="title"><InlineText text={pr.record.title ?? `#${pr.number}`} /></span>
			<span class="faint meta">{pr.owner}/{pr.repo} #{pr.number}{author ? ` · ${author}` : ''}{raised ? ` · ${timeAgo(raised, page.now)}` : ''}</span>
		</span>
	</a>
	<span class="baubles">
		{#if pr.unsaved}
			<span class="round">
				<a class="hit" {href} aria-label="Not opened in Docent yet{view.note ? `. ${view.note}` : ''}"><RoundBauble tone="new" /></a>
				<span class="card" role="tooltip">
					<strong>Not opened in Docent yet</strong>
					{#if view.note}<span class="faint">{view.note}</span>{/if}
				</span>
			</span>
		{/if}
		{#each view.rounds as r (r.n)}
			{@const name = view.rounds.length > 1 ? `Round ${r.n} · ` : ''}
			{@const label = r.draft ? 'Not started' : r.label}
			<span class="round">
				<a class="hit" href={r.href} aria-label="{name}{label}"><RoundBauble tone={r.tone} draft={r.draft} complete={r.label === 'Complete'} /></a>
				<span class="card" role="tooltip">
					<strong>{name}{label}</strong>
					{#if r.commits}<span class="faint">{plural(r.commits, 'commit')}{r.dates ? ` · ${r.dates}` : ''}</span>{/if}
					{#if r.progress || r.findings}
						<span class="faint">
							{r.progress ? `${r.progress.done} of ${r.progress.total} slices read` : ''}{r.progress && r.findings ? ' · ' : ''}{r.findings ? plural(r.findings, 'finding') : ''}
						</span>
					{/if}
					{#if r.deletable}<button class="delete" onclick={() => page.deleteRound(pr)}>Delete round {r.n}</button>{/if}
				</span>
			</span>
		{/each}
		{#if view.fresh}
			<!-- Into the round being set up, if there is one, else a new one. -->
			{@const draft = view.rounds.at(-1)?.draft ? view.rounds.at(-1) : undefined}
			{@const next = draft ? draft.n : view.rounds.length + 1}
			{@const since = draft ? draft.n - 1 : view.rounds.length}
			<span class="round">
				<button
					class="hit fresh"
					aria-label="{plural(view.fresh, 'new commit')}: review as round {next}"
					onclick={async () => goto(draft ? draft.href : await page.startRound(pr))}
				>
					+{view.fresh}
				</button>
				<span class="card" role="tooltip">
					<strong>{plural(view.fresh, 'new commit')}</strong>
					<span class="faint">Since round {since}. Review {view.fresh === 1 ? 'it' : 'them'} as round {next}.</span>
				</span>
			</span>
		{/if}
	</span>
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
		gap: 16px;
		border-top: 1px solid var(--line);
	}
	.main {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 20px 0 20px 2px;
		text-decoration: none;
	}
	.main:hover .title {
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
	.baubles {
		flex: none;
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
	}
	.round {
		position: relative;
		display: flex;
	}
	/* A bigger target than the mark itself. */
	.hit {
		display: grid;
		place-items: center;
		min-width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 13px;
		background: none;
		cursor: pointer;
		text-decoration: none;
	}
	.hit:hover,
	.hit:focus-visible {
		background: var(--surface-2);
	}
	.fresh {
		height: 18px;
		min-width: 0;
		margin-left: 4px;
		padding: 0 6px;
		border-radius: 9px;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--you) 70%, transparent);
		color: var(--you-text);
		font: inherit;
		font-size: 11.5px;
		font-weight: 500;
	}
	.fresh:hover,
	.fresh:focus-visible {
		background: var(--you-chip);
	}
	/* What a round holds, on hover or focus, below and to the right. */
	.card {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		right: 0;
		display: none;
		flex-direction: column;
		gap: 3px;
		min-width: 190px;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 20px 40px -16px rgba(0, 0, 0, 0.7);
		font-size: 12.5px;
		white-space: nowrap;
	}
	/* Bridges the gap down to the card, so moving onto it keeps it open. */
	.card::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -8px;
		height: 8px;
	}
	.round:hover .card,
	.round:focus-within .card {
		display: flex;
	}
	.card strong {
		font-weight: 500;
		font-size: 13px;
	}
	.delete {
		align-self: flex-start;
		margin-top: 6px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--faint);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.delete:hover {
		color: var(--danger);
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
