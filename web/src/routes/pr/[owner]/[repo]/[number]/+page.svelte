<script lang="ts">
	import PreparingView from '$lib/components/PreparingView.svelte';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';
	import StateMark from '$lib/components/StateMark.svelte';

	// A stand-in Overview; step 2 of the rewrite replaces it with mockup A's.
	const session = useSession();
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
</script>

{#if session.preparing}
	<PreparingView />
{:else}
	<main>
		<h1>{session.title}</h1>
		{#if session.record.summary}
			<p>{session.record.summary.what}</p>
		{/if}
		<ol>
			{#each session.slices as slice (slice.id)}
				<li>
					<StateMark state={isSliceReviewed(slice, session.record.reviewed) ? 'done' : 'todo'} />
					<a href="{base}/slices/{slice.id}">{slice.title}</a>
				</li>
			{/each}
		</ol>
	</main>
{/if}

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 56px 24px;
	}
	h1 {
		font-family: var(--serif);
		font-weight: 500;
		font-size: 36px;
		line-height: 1.15;
	}
	p {
		color: var(--muted);
		line-height: 1.6;
	}
	ol {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 0;
	}
</style>
