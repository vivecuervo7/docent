<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { groupsOf, isShown, reviewerName } from '$lib/features/panel/findings';
	import Spinner from '$lib/ui/Spinner.svelte';
	import WrapRow from '$lib/features/wrap-up/WrapRow.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import { SEVERITY_ORDER, type FeedbackItem } from '$lib/types';

	// Wrap up: confirming what goes into the review. Your threads are drafted
	// into the comments they'd post as it opens; with the panel's findings,
	// each is kept or skipped. They're grouped by where they were said - the
	// PR as a whole, then each slice - yours first in each.
	const session = useSession();
	const base = $derived(session.base);
	const groups = $derived(groupsOf(session.record));

	const findings = $derived(
		Object.entries(session.record.feedback)
			.filter(([key]) => key.startsWith('agent-'))
			.flatMap(([reviewer, draft]) => (draft?.items ?? []).filter(isShown).map((item) => ({ reviewer, item })))
			// A group is listed once, under its lead.
			.filter(({ reviewer, item }) => !groups.joined(reviewer, item))
	);
	const yours = $derived(session.record.feedback.yours?.items ?? []);

	// The most serious first; findings without a severity after the rest.
	// Ones the editor suggests skipping come last.
	const rank = (i: FeedbackItem) =>
		(i.skipSuggested ? SEVERITY_ORDER.length + 1 : 0) + (i.severity ? SEVERITY_ORDER.indexOf(i.severity) : SEVERITY_ORDER.length);

	// Which group something sits in: a slice, by the thread it came from or
	// the lines it's on, else the PR as a whole.
	function groupOf(item: FeedbackItem): string {
		const notes = session.record.notes.filter((n) => item.noteIds?.includes(n.id));
		const slice = notes.find((n) => n.slice)?.slice;
		if (slice) return slice;
		if (!item.path) return 'pr';
		return session.slicesOf(item.path, item.start)[0] ?? 'elsewhere';
	}
	const sections = $derived.by(() => {
		const titled = [
			{ id: 'pr', title: 'The whole PR' },
			...session.slices.map((s, i) => ({ id: s.id, title: `Slice ${i + 1} · ${s.title}` })),
			{ id: 'elsewhere', title: 'Elsewhere' }
		];
		return titled
			.map((g) => ({
				...g,
				yours: yours.filter((i) => groupOf(i) === g.id),
				findings: findings.filter((f) => groupOf(f.item) === g.id).sort((a, b) => rank(a.item) - rank(b.item))
			}))
			.filter((g) => g.yours.length || g.findings.length);
	});

	const kept = $derived(yours.filter((i) => i.included).length + findings.filter((f) => f.item.decided && f.item.included).length);
	const skipped = $derived(yours.filter((i) => !i.included).length + findings.filter((f) => f.item.decided && !f.item.included).length);
	const toDecide = $derived(findings.filter((f) => !f.item.decided).length);

	// Threads new since the draft are drafted as Wrap up opens; once, so a
	// draft that fails isn't asked for again and again.
	let asked = false;
	$effect(() => {
		const undrafted = session.undrafted;
		if (asked || session.loading || session.yourDraft.pending || !undrafted.length) return;
		asked = true;
		untrack(() => session.draftYourComments(undrafted.map((n) => n.id)));
	});

	const changed = (item: FeedbackItem) => (item.noteIds ?? []).some((id) => session.changedThreads.has(id));
	const redraft = (item: FeedbackItem) =>
		session.draftYourComments((item.noteIds ?? []).filter((id) => session.record.notes.some((n) => n.id === id)));

	// Opens a finding or a thread where it was raised: the slice holding its
	// lines or file, or for something about the PR as a whole, the Overview.
	function show(id: string, path: string | undefined, start: FeedbackItem['start']) {
		if (!path) return goto(base);
		const slice = session.slicesOf(path, start)[0];
		if (!slice) return;
		session.revealing = id;
		goto(`${base}/slices/${slice}`);
	}

	const threadOf = (item: FeedbackItem) => session.record.notes.find((n) => n.id === item.noteIds?.[0]);
	// A thread about the PR as a whole sits on the Overview, not a slice.
	const onOverview = (item: FeedbackItem) => {
		const note = threadOf(item);
		return !!note && !note.slice && !note.path && !note.github;
	};

	function showThread(item: FeedbackItem) {
		const note = threadOf(item);
		if (!note) return;
		if (note.slice) {
			session.revealing = note.id;
			return goto(`${base}/slices/${note.slice}`);
		}
		if (!note.path && !note.github) {
			session.revealing = note.id;
			return goto(base);
		}
		// A thread about something said on GitHub opens from that thread.
		show(note.github ?? note.id, note.path, note.start);
	}

	// The first time through, preparing starts on the way to Post.
	function toPost() {
		if (!session.post.draft) session.post.prepare();
		goto(`${base}/post`);
	}
</script>

{#snippet finding({ reviewer, item }: { reviewer: string; item: FeedbackItem })}
	<WrapRow
		kind="finding"
		who={reviewerName(session.record, reviewer)}
		speculative={item.speculative}
		onPr={item.onPr}
		setAside={item.setAside}
		skipSuggested={item.skipSuggested}
		raisedBefore={item.raisedBefore}
		outsideRound={item.outsideRound}
		notes={{ impact: item.impact, impactLevel: item.impactLevel, checked: item.checked, checkedVerdict: item.checkedVerdict }}
		suggested={!item.decided}
		severity={item.severity}
		path={item.path}
		start={item.start}
		end={item.end}
		body={item.body}
		rationale={item.rationale}
		messages={item.messages}
		alsoBy={groups.membersOf(reviewer, item.id).map((m) => ({ who: reviewerName(session.record, m.reviewer), body: m.item.body }))}
		kept={item.included ?? true}
		onshow={item.path ? () => show(item.id, item.path, item.start) : undefined}
		onkeep={() => session.setFindingIncluded(reviewer, item.id, true)}
		onskip={() => session.setFindingIncluded(reviewer, item.id, false)}
	/>
{/snippet}

{#snippet mine(item: FeedbackItem)}
	<WrapRow
		kind="yours"
		who="You"
		path={item.path}
		start={item.start}
		end={item.end}
		body={item.body}
		rationale={item.rationale}
		kept={item.included}
		changed={changed(item)}
		onredraft={session.yourDraft.pending ? undefined : () => redraft(item)}
		onshow={item.noteIds?.length ? () => showThread(item) : undefined}
		showLabel={onOverview(item) ? 'Show on the Overview' : undefined}
		onkeep={() => session.setYourIncluded(item.id, true)}
		onskip={() => session.setYourIncluded(item.id, false)}
	/>
{/snippet}

<main>
	<div class="intro">
		<h1>Wrap up</h1>
		<p class="lede">Each of yours is drafted as the comment it would post. Keep what belongs in your review.</p>
		{#if session.threads.length}
			<div class="status faint">
				{#if session.yourDraft.pending}
					<span class="drafting"><Spinner size={13} /> Drafting from your threads…</span>
				{:else if session.record.feedback.yours}
					<span>
						Drafted from your threads{#if session.changedThreads.size}{` · ${session.changedThreads.size} changed since`}{/if}
					</span>
				{/if}
				<span class="grow"></span>
				{#if !session.yourDraft.pending && session.record.feedback.yours}
					<button class="link" onclick={() => session.draftYourComments()}>Redraft all</button>
				{/if}
			</div>
		{/if}
		{#if session.yourDraft.error}<p class="bad">Couldn’t draft: {session.yourDraft.error}</p>{/if}
	</div>

	{#each sections as group (group.id)}
		<section>
			<h2>{group.title}</h2>
			<ul>
				{#each group.yours as item (item.id)}{@render mine(item)}{/each}
				{#each group.findings as f (f.item.id)}{@render finding(f)}{/each}
			</ul>
		</section>
	{:else}
		{#if !session.yourDraft.pending}
			<p class="empty">
				{session.threads.length
					? 'Nothing in your threads reads as a comment for the author, and the panel found nothing.'
					: 'Nothing yet. Select lines while reading, or use the Ask bar, to ask or comment.'}
			</p>
		{/if}
	{/each}

	<div class="next">
		<span class="faint tally">{kept} kept · {skipped} skipped{#if toDecide}{` · ${toDecide} to decide`}{/if}</span>
		<span class="grow"></span>
		{#if session.post.stale}<span class="faint stale-note">The prepared review is out of date.</span>{/if}
		<button class="btn primary big" onclick={toPost}>{session.post.draft ? 'On to Post →' : 'Prepare the review →'}</button>
	</div>
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
	.intro {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13px;
	}
	.grow {
		flex-grow: 1;
	}
	.tally {
		font-size: 13.5px;
	}
	h1 {
		margin: 0;
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
	h2 {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
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
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		overflow: hidden;
	}
	.empty {
		margin: 4px 0 0;
		color: var(--faint);
		font-size: 14px;
	}
	.next {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.stale-note {
		font-size: 13.5px;
	}
	.big {
		height: 42px;
		padding: 0 18px;
		border-radius: 12px;
		font-size: 14.5px;
	}
	.bad {
		margin: 0;
		color: var(--danger);
		font-size: 14px;
	}
</style>
