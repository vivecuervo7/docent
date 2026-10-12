<script lang="ts">
	import { page } from '$app/state';
	import TopBar from '$lib/session/TopBar.svelte';
	import { PrSession, provideSession } from '$lib/session/session.svelte';

	let { children } = $props();

	// Fixed for this layout's life: ../../../+layout.svelte remounts it for
	// another PR.
	const { owner, repo, number } = page.params as { owner: string; repo: string; number: string };
	const session = new PrSession({ owner, repo, number });
	provideSession(session);

	$effect(() => {
		session.open();
		return () => session.close();
	});
</script>

<svelte:head><title>{session.title} · Docent</title></svelte:head>

<TopBar />
{#if session.loading}
	<p class="status faint">Loading the PR…</p>
{:else if session.error}
	<div class="status">
		<p>Couldn't open this PR: {session.error}</p>
		<a class="btn" href="/">Back to your reviews</a>
	</div>
{:else}
	{#if session.round !== null}
		<p class="earlier">
			Round {session.round + 1}, an earlier review: reviewers run, and reviews post, only in the latest.
			<button onclick={() => session.viewRound(null)}>Back to round {session.roundCount}</button>
		</p>
	{/if}
	{@render children()}
{/if}

<style>
	.status {
		max-width: 640px;
		margin: 80px auto;
		padding: 0 24px;
		font-size: 15px;
	}
	.status .btn {
		text-decoration: none;
	}
	.earlier {
		margin: 0;
		padding: 8px 24px;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		color: var(--faint);
		font-size: 13px;
		text-align: center;
	}
	.earlier button {
		border: 0;
		background: none;
		padding: 0;
		margin-left: 6px;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
</style>
