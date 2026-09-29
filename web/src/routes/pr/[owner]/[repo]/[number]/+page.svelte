<script lang="ts">
	import FindingCard from '$lib/features/panel/FindingCard.svelte';
	import InlineText from '$lib/components/InlineText.svelte';
	import PanelCard from '$lib/features/panel/PanelCard.svelte';
	import PreparingView from '$lib/features/preparing/PreparingView.svelte';
	import ReviewModel from '$lib/features/preparing/ReviewModel.svelte';
	import StateMark from '$lib/components/StateMark.svelte';
	import { isGenerating, isSliceReviewed, useSession } from '$lib/session.svelte';

	// The Overview: what the PR is, its slices, and the review panel to start
	// before reading. Kept plain on purpose. The conversation summary is saved
	// for Wrap up to dedupe against, not shown here.

	const session = useSession();
	// The panel's findings about the whole PR, rather than a file.
	const wholePr = $derived(session.looseFindings.filter((f) => !f.mark.path).map((f) => f.mark));
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	const summary = $derived(session.record.summary);
	const githubUrl = $derived(
		session.meta?.htmlUrl ?? `https://github.com/${session.ref.owner}/${session.ref.repo}/pull/${session.ref.number}`
	);
</script>

{#if session.preparing}
	<PreparingView />
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

			{#if wholePr.length}
				<!-- Findings about the PR as a whole have no file to sit on in the diff. -->
				<div class="block whole-pr">
					<h2>About the PR as a whole</h2>
					{#each wholePr as mark (mark.id)}<FindingCard {mark} />{/each}
				</div>
			{/if}
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
</style>
