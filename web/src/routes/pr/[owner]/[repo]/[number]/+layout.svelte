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
	// The round in the URL, "round-2"; none is the latest.
	$effect(() => {
		const round = page.params.round;
		session.goToRound(round ? Number(round.slice('round-'.length)) : null);
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
{:else if session.switchingRound}
	<p class="status faint">Loading round {(session.round ?? session.roundCount - 1) + 1}…</p>
{:else}
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
</style>
