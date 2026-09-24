<script lang="ts">
	// One quiet button: collapses every file while any is open, and expands
	// them all when none are.
	let { anyOpen, onfold }: { anyOpen: boolean; onfold: (open: boolean) => void } = $props();
	const label = $derived(anyOpen ? 'Collapse all files' : 'Expand all files');
</script>

<button class="fold-all" aria-label={label} title={label} onclick={() => onfold(!anyOpen)}>
	{#if anyOpen}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></svg>
	{:else}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
	{/if}
</button>

<style>
	.fold-all {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--faint);
		cursor: pointer;
	}
	.fold-all:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
	}
</style>
