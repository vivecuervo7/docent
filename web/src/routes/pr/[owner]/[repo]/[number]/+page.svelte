<script lang="ts">
	import FindingCard from '$lib/features/panel/FindingCard.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import PanelCard from '$lib/features/panel/PanelCard.svelte';
	import BeginReview from '$lib/features/preparing/BeginReview.svelte';
	import PreparingView from '$lib/features/preparing/PreparingView.svelte';
	import ReviewModel from '$lib/features/preparing/ReviewModel.svelte';
	import StateMark from '$lib/ui/StateMark.svelte';
	import Composer, { type SendKind } from '$lib/features/reading/Composer.svelte';
	import ThreadPanel from '$lib/features/reading/ThreadPanel.svelte';
	import GitHubThreadPanel from '$lib/features/reading/GitHubThreadPanel.svelte';
	import Disclosure from '$lib/ui/Disclosure.svelte';
	import { looseNotesFrom } from '$lib/features/reading/marks';
	import { isGenerating, isSliceReviewed, useSession } from '$lib/session/session.svelte';

	// The Overview: what the PR is, its slices, and the review panel to start
	// before reading. Kept plain on purpose. The conversation summary is saved
	// for Wrap up to dedupe against, not shown here.

	const session = useSession();
	// The panel's findings about the whole PR, rather than a file.
	const wholePr = $derived(session.looseFindings.filter((f) => !f.mark.path).map((f) => f.mark));
	// Your threads on the PR as a whole, and the one being written.
	const prThreads = $derived(looseNotesFrom(session.record).filter((n) => !n.path));
	let draft = $state('');
	// What's been said on GitHub about the PR as a whole, folded away.
	const general = $derived(session.github?.general ?? []);
	let showGeneral = $state(false);
	const startThread = (text: string, kind: SendKind) => session.createNote({ path: '' }, text, { comment: kind === 'comment' });
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	const summary = $derived(session.record.summary);
	const githubUrl = $derived(
		session.meta?.htmlUrl ?? `https://github.com/${session.ref.owner}/${session.ref.repo}/pull/${session.ref.number}`
	);
</script>

{#if session.preparing}
	<PreparingView />
{:else if session.unprepared && !session.loading}
	<BeginReview />
{:else}
	<main>
		<section class="about">
			<div class="heading">
				<h1><InlineText text={session.title} /></h1>
				<p class="byline faint">
					{session.ref.owner}/{session.ref.repo}#{session.ref.number}{#if session.meta?.author}{' '}by {session.meta.author}{/if}
					· <ReviewModel /> ·
					<a href={githubUrl} target="_blank" rel="noreferrer">View on GitHub ↗</a>
				</p>
				{#if session.roundCount > 1}
					<p class="rounds faint">
						{#each { length: session.roundCount } as _, i (i)}
							{@const latest = i === session.roundCount - 1}
							{@const current = latest ? session.round === null : session.round === i}
							{#if i > 0}<span aria-hidden="true">·</span>{/if}
							{#if current}<span class="current">Round {i + 1}</span>
							{:else}<button class="link" onclick={() => session.viewRound(latest ? null : i)}>Round {i + 1}</button>{/if}
						{/each}
					</p>
				{/if}
				{#if session.newCommits}
					<p class="new-commits">
						New commits since this round was prepared.
						<button class="link" onclick={() => session.nextRound()}>Review them as round {session.roundCount + 1}</button>
					</p>
				{/if}
			</div>

			{#if summary}
				<div class="summary">
					<p><InlineText text={summary.what} /></p>
					<p><InlineText text={summary.why} /></p>
					{#if summary.how}<p><InlineText text={summary.how} /></p>{/if}
				</div>
			{/if}

			<div class="block">
				{#if isGenerating(session.generation)}<span class="faint small">Updating…</span>{/if}
				<ol class="slices">
					{#each session.slices as slice (slice.id)}
						<li>
							<StateMark state={isSliceReviewed(slice, session.reviewed) ? 'done' : 'todo'} />
							<a href="{base}/slices/{slice.id}">{slice.title}</a>
						</li>
					{/each}
				</ol>
			</div>

			<!-- Findings and your threads about the PR as a whole have no file to
			     sit on in the diff. Your comments here lead the posted review. -->
			<div class="block whole-pr">
				<h2>About the PR as a whole</h2>
				{#each wholePr as mark (mark.id)}<FindingCard {mark} />{/each}
				{#each prThreads as note (note.id)}<div class="pr-thread"><ThreadPanel {note} /></div>{/each}
				{#if general.length}
					<Disclosure bind:open={showGeneral} label="Said on GitHub" count={general.length} />
					{#if showGeneral}
						{#each general as c (c.id)}<div class="pr-thread"><GitHubThreadPanel comment={c} /></div>{/each}
					{/if}
				{/if}
				<Composer bind:value={draft} placeholder="Ask about the PR, or write a comment for the review…" onsend={startThread} />
			</div>
		</section>

		<aside>
			<PanelCard />
		</aside>
	</main>
{/if}

<style>
	main {
		max-width: 1320px;
		margin: 0 auto;
		box-sizing: border-box;
		padding: 56px 64px 80px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 440px;
		gap: 72px;
		align-items: start;
	}
	@media (max-width: 1100px) {
		main {
			grid-template-columns: minmax(0, 1fr);
			padding: 40px 24px 64px;
			gap: 40px;
		}
	}
	.about {
		display: flex;
		flex-direction: column;
		gap: 30px;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: 40px;
		line-height: 1.12;
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	.heading {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.byline {
		margin: 0;
		font-size: 13.5px;
	}
	.byline a {
		color: var(--muted);
		text-underline-offset: 3px;
	}
	.byline a:hover {
		color: var(--text);
	}
	.rounds,
	.new-commits {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		font-size: 13.5px;
	}
	.rounds .current {
		color: var(--text);
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.summary p {
		margin: 0;
		color: var(--muted);
		font-size: 15.5px;
		line-height: 1.65;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.small {
		font-size: 13px;
	}
	.whole-pr {
		display: grid;
		gap: 12px;
	}
	.whole-pr h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.slices {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.slices li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 0;
		font-size: 15px;
	}
	.slices a:hover {
		color: #fff;
	}
	aside {
		position: sticky;
		top: 96px;
	}
	.pr-thread {
		border-radius: 14px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line-2);
		overflow: hidden;
	}
</style>
