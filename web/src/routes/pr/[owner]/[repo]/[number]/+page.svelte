<script lang="ts">
	let { data } = $props();
	const base = $derived(`/pr/${data.owner}/${data.repo}/${data.number}`);
</script>

<main>
	<h1>{data.title}</h1>
	<ol>
		{#each data.record.slices ?? [] as slice (slice.id)}
			<li><a href="{base}/slices/{slice.id}">{slice.title}</a></li>
		{/each}
	</ol>
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 64px 24px;
	}
	h1 {
		font-family: var(--serif);
		font-weight: 500;
		font-size: 36px;
	}
	li {
		padding: 8px 0;
	}
</style>
