<script lang="ts">
	import Spinner from '$lib/ui/Spinner.svelte';

	// A round at a glance, in one of two marks: a ring while it's open, filled
	// once it's done (posted or complete); dashed while it's being set up, a
	// spinner while it's preparing.
	// Its card says the rest.
	let { done = false, working = false, draft = false }: { done?: boolean; working?: boolean; draft?: boolean } = $props();
</script>

<span class="bauble" class:done aria-hidden="true">
	{#if working}
		<Spinner size={10} />
	{:else}
		<svg width="10" height="10" viewBox="0 0 10 10">
			{#if draft}
				<circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.8 1.6" />
			{:else if done}
				<circle cx="5" cy="5" r="4" fill="currentColor" />
			{:else}
				<circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.4" />
			{/if}
		</svg>
	{/if}
</span>

<style>
	.bauble {
		display: grid;
		place-items: center;
		width: 10px;
		height: 10px;
		color: var(--you);
	}
	/* The same green as a complete badge. */
	.done {
		color: #7fd89b;
	}
</style>
