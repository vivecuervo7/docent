<script lang="ts">
	import { goto } from '$app/navigation';
	import { reviewerName } from '$lib/api';
	import Spinner from '$lib/components/Spinner.svelte';
	import WrapRow from '$lib/components/WrapRow.svelte';
	import { useSession } from '$lib/session.svelte';
	import type { FeedbackItem } from '$lib/types';

	// Wrap up: settling what goes into the review. The panel's findings still
	// waiting on a decision come first, then your own comments, drafted from
	// your threads; what's already kept or skipped sits folded away.
	const session = useSession();
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);

	const findings = $derived(
		Object.entries(session.record.feedback)
			.filter(([key]) => key.startsWith('agent-'))
			.flatMap(([reviewer, draft]) => (draft?.items ?? []).map((item) => ({ reviewer, item })))
	);
	const undecided = $derived(findings.filter((f) => !f.item.decided));
	const kept = $derived(findings.filter((f) => f.item.decided && f.item.included));
	const skipped = $derived(findings.filter((f) => f.item.decided && !f.item.included));
	const yours = $derived(session.record.feedback.yours?.items ?? []);


	// Opens a finding or a thread where it sits in the diff.
	function show(id: string, path: string | undefined, start: FeedbackItem['start']) {
		if (!path) return;
		const slice = session.slicesOf(path, start)[0];
		if (!slice) return;
		session.revealing = id;
		goto(`${base}/slices/${slice}`);
	}

	function showThread(item: FeedbackItem) {
		const note = session.record.notes.find((n) => n.id === item.noteIds?.[0]);
		if (note) show(note.id, note.path, note.start);
	}
</script>

{#snippet finding({ reviewer, item }: { reviewer: string; item: FeedbackItem })}
	<WrapRow
		kind="finding"
		who={reviewerName(session.record, reviewer)}
		path={item.path}
		start={item.start}
		end={item.end}
		body={item.body}
		rationale={item.rationale}
		kept={item.decided ? item.included : null}
		onkeep={() => session.setFindingIncluded(reviewer, item.id, true)}
		onskip={() => session.setFindingIncluded(reviewer, item.id, false)}
		onshow={item.path && item.start ? () => show(item.id, item.path, item.start) : undefined}
	/>
{/snippet}

<main>
	<h1>Wrap up</h1>
	<p class="lede">What goes into your review. Anything kept is merged and tidied when you prepare it.</p>

	<section>
		<h2>Still to decide <span class="count">{undecided.length}</span></h2>
		{#if undecided.length}
			<ul>{#each undecided as f (f.item.id)}{@render finding(f)}{/each}</ul>
		{:else}
			<p class="empty">Nothing from the panel is waiting on you.</p>
		{/if}
	</section>

	<section>
		<div class="section-head">
			<h2>Your comments <span class="count">{yours.length}</span></h2>
			{#if session.yourDraft.pending}
				<span class="faint drafting"><Spinner size={13} /> Drafting…</span>
			{:else if session.threads.length && (!session.record.feedback.yours || session.threadsChanged)}
				<button class="btn" onclick={() => session.draftYourComments()}>
					{session.record.feedback.yours ? 'Draft again from your threads' : 'Draft from your threads'}
				</button>
			{/if}
		</div>
		{#if session.yourDraft.error}
			<p class="bad">Couldn’t draft: {session.yourDraft.error}</p>
		{/if}
		{#if session.record.feedback.yours && session.threadsChanged && !session.yourDraft.pending}
			<p class="faint note">Your threads have changed since these were drafted.</p>
		{/if}
		{#if yours.length}
			<ul>
				{#each yours as item (item.id)}
					<WrapRow
						kind="yours"
						path={item.path}
						start={item.start}
						end={item.end}
						body={item.body}
						rationale={item.rationale}
						kept={item.included}
						onkeep={() => session.setYourIncluded(item.id, true)}
						onskip={() => session.setYourIncluded(item.id, false)}
						onshow={item.noteIds?.length ? () => showThread(item) : undefined}
					/>
				{/each}
			</ul>
		{:else if !session.threads.length}
			<p class="empty">No threads yet. Select lines while reading to ask or comment.</p>
		{:else if !session.record.feedback.yours}
			<p class="empty">{session.threads.length} {session.threads.length === 1 ? 'thread' : 'threads'} to draft comments from.</p>
		{:else if !session.yourDraft.pending}
			<p class="empty">Nothing in your threads reads as a comment for the author.</p>
		{/if}
	</section>

	{#if kept.length}
		<section>
			<button class="fold-head" aria-expanded={session.wrapUpOpen.kept} onclick={() => (session.wrapUpOpen.kept = !session.wrapUpOpen.kept)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={session.wrapUpOpen.kept ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				Kept from the panel <span class="count">{kept.length}</span>
			</button>
			{#if session.wrapUpOpen.kept}<ul>{#each kept as f (f.item.id)}{@render finding(f)}{/each}</ul>{/if}
		</section>
	{/if}

	{#if skipped.length}
		<section>
			<button class="fold-head" aria-expanded={session.wrapUpOpen.skipped} onclick={() => (session.wrapUpOpen.skipped = !session.wrapUpOpen.skipped)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={session.wrapUpOpen.skipped ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				Skipped <span class="count">{skipped.length}</span>
			</button>
			{#if session.wrapUpOpen.skipped}<ul>{#each skipped as f (f.item.id)}{@render finding(f)}{/each}</ul>{/if}
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 860px;
		margin: 0 auto;
		padding: 56px 24px 96px;
		display: flex;
		flex-direction: column;
		gap: 36px;
	}
	h1 {
		margin: 0 0 -24px;
		font-family: var(--serif);
		font-size: 38px;
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	.lede {
		margin: 0;
		color: var(--muted);
		font-size: 15px;
	}
	section {
		display: flex;
		flex-direction: column;
	}
	h2,
	.fold-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin: 0 0 8px;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.fold-head {
		align-items: center;
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font-size: 19px;
		cursor: pointer;
	}
	.fold-head:hover {
		color: var(--text);
	}
	.count {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--faint);
	}
	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.drafting {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.empty,
	.note {
		margin: 4px 0 0;
		color: var(--faint);
		font-size: 14px;
	}
	.bad {
		margin: 4px 0 8px;
		color: var(--danger);
		font-size: 14px;
	}
</style>
