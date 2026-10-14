<script lang="ts">
	import Spinner from '$lib/ui/Spinner.svelte';

	// A round at a glance, in one of two marks: a ring while it's open, filled
	// once it's done (posted or complete); a spinner while it's preparing.
	// Its card says the rest.
	let { done = false, working = false }: { done?: boolean; working?: boolean } = $props();
</script>

<span class="bauble" class:done aria-hidden="true">
	{#if working}
		<Spinner size={13} />
	{:else}
		<svg width="14" height="14" viewBox="0 0 14 14">
			{#if done}
				<circle cx="7" cy="7" r="5.5" fill="currentColor" />
			{:else}
				<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.5" />
			{/if}
		</svg>
	{/if}
</span>

<style>
	.bauble {
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		color: var(--you);
	}
	.done {
		color: var(--done);
	}
</style>
