<script lang="ts">
	import type { Snippet } from 'svelte';

	// One section of the Settings page: its heading, a line on what it's for,
	// and what's in it.
	let { title, intro, children }: { title: string; intro?: string; children: Snippet } = $props();
</script>

<section>
	<h2>{title}</h2>
	{#if intro}<p class="intro">{intro}</p>{/if}
	{@render children()}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 8px 0 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.intro {
		margin: 0;
		color: var(--faint);
		font-size: 14px;
		line-height: 1.6;
	}
</style>
