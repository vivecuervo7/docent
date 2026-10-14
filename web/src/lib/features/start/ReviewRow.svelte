<script lang="ts">
	import { goto } from '$app/navigation';
	import InlineText from '$lib/ui/InlineText.svelte';
	import { timeAgo } from '$lib/ui/format';
	import RoundBauble from './RoundBauble.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import type { RoundBauble as Round, Row, StartPage } from './startPage.svelte';

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
	{#snippet card(r: Round, name: string)}
		<span class="card" role="tooltip">
			<strong><span class="mark {r.draft ? 'quiet' : r.tone}"></span>{name}{r.draft ? 'Not started' : r.label}</strong>
			{#if r.commits}<span class="faint">{plural(r.commits, 'commit')}{r.dates ? ` · ${r.dates}` : ''}</span>{/if}
			{#if r.progress || r.findings}
				<span class="faint">
					{r.progress ? `${r.progress.done} of ${r.progress.total} slices read` : ''}{r.progress && r.findings ? ' · ' : ''}{r.findings ? plural(r.findings, 'finding') : ''}
				</span>
			{/if}
			{#if r.deletable}<button class="delete" onclick={() => page.deleteRound(pr)}>Delete round {r.n}</button>{/if}
		</span>
	{/snippet}
	<span class="state">
		<!-- Its rounds in order, joined, then the next round when there's one to
		     review: new commits, or a round being set up for them. The row's
		     badge is what it asks of you: the next round once the last is done,
		     else the last round; the rest are marks. -->
		{#if pr.unsaved}
			<span class="round">
				<a class="badge new" {href}>New</a>
				<span class="card" role="tooltip">
					<strong><span class="mark new"></span>Not opened in Docent yet</strong>
					{#if view.note}<span class="faint">{view.note}</span>{/if}
				</span>
			</span>
		{:else if view.rounds.length}
			{@const draft = view.rounds.at(-1)?.draft ? view.rounds.at(-1) : undefined}
			{@const rounds = draft ? view.rounds.slice(0, -1) : view.rounds}
			{@const last = rounds.at(-1)}
			{@const hasNext = !!draft || view.fresh > 0}
			{@const nextFirst = hasNext && (!last || last.tone === 'done')}
			{@const next = draft ? draft.n : view.rounds.length + 1}
			{@const several = view.rounds.length > 1 || hasNext}
			<span class="chain">
				{#each rounds as r, i (r.n)}
					<span class="round">
						{#if !nextFirst && i === rounds.length - 1}
							<a class="badge {r.tone}" href={r.href}>{#if r.tone === 'working'}<Spinner size={11} />{/if}{r.label}</a>
						{:else}
							<a class="hit" href={r.href} aria-label="Round {r.n} · {r.label}"
								><RoundBauble done={r.tone === 'done'} working={r.tone === 'working'} /></a
							>
						{/if}
						{@render card(r, several ? `Round ${r.n} · ` : '')}
					</span>
				{/each}
				{#if hasNext}
					{@const commits = view.fresh ? plural(view.fresh, 'new commit') : ''}
					{@const open = async () => goto(draft ? draft.href : await page.startRound(pr))}
					<span class="round">
						{#if nextFirst}
							<button class="badge next" onclick={open}>{commits || 'Not started'}</button>
						{:else}
							<button class="fresh" aria-label="{commits}: review as round {next}" onclick={open}>+{view.fresh}</button>
						{/if}
						<span class="card" role="tooltip">
							<strong><span class="mark ready"></span>Round {next} · {draft ? 'Not started' : 'To review'}</strong>
							{#if commits}<span class="faint">{commits} since round {next - 1}</span>{/if}
							{#if draft}<button class="delete" onclick={() => page.deleteRound(pr)}>Delete round {draft.n}</button>{/if}
						</span>
					</span>
				{/if}
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
	.state {
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		padding-right: 4px;
	}
	.round {
		position: relative;
		display: flex;
		align-items: center;
	}
	/* Rounds joined like commits on a track, the line meeting each mark. */
	.chain {
		display: flex;
		align-items: center;
	}
	.chain .round + .round::before {
		content: '';
		width: 10px;
		height: 1.5px;
		background: color-mix(in srgb, var(--faint) 70%, transparent);
	}
	.hit {
		position: relative;
		display: grid;
		place-items: center;
		border-radius: 50%;
		text-decoration: none;
	}
	/* A bigger target than the mark, without spacing the line off it. */
	.hit::after {
		content: '';
		position: absolute;
		inset: -6px -4px;
	}
	.hit:hover,
	.hit:focus-visible {
		filter: brightness(1.3);
	}
	/* The next round, to begin: dashed, as it isn't one yet. */
	.badge.next {
		--tone: #8ab4ff;
		border: 0;
		background: none;
		box-shadow: none;
		outline: 1px dashed color-mix(in srgb, var(--tone) 70%, transparent);
		outline-offset: -1px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		cursor: pointer;
	}
	.badge.next:hover,
	.badge.next:focus-visible {
		background: color-mix(in srgb, var(--tone) 12%, transparent);
	}
	.fresh {
		height: 18px;
		padding: 0 6px;
		border: 0;
		border-radius: 9px;
		background: none;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--you) 70%, transparent);
		color: var(--you-text);
		font: inherit;
		font-size: 11.5px;
		font-weight: 500;
		cursor: pointer;
	}
	.fresh:hover,
	.fresh:focus-visible {
		background: var(--you-chip);
	}
	/* The round the row opens, as a badge tinted in its state's colour. */
	.badge {
		--tone: var(--faint);
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
		text-decoration: none;
	}
	.badge.new,
	.mark.new {
		--tone: #c8a8ff;
	}
	.badge.working,
	.mark.working {
		--tone: #e8e2d6;
	}
	.badge.ready,
	.mark.ready {
		--tone: #8ab4ff;
	}
	.badge.going,
	.mark.going {
		--tone: #ffb85c;
	}
	.badge.read,
	.mark.read {
		--tone: var(--muted);
	}
	.badge.done,
	.mark.done {
		--tone: #7fd89b;
	}
	.badge.bad,
	.mark.bad {
		--tone: #ff8a7a;
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
		display: flex;
		align-items: center;
		gap: 7px;
		font-weight: 500;
		font-size: 13px;
	}
	/* The state, in its colour, where there's room to say it. */
	.mark {
		--tone: var(--faint);
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--tone);
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
