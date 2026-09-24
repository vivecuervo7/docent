<script lang="ts">
	// One quiet button that closes every file on the page, then opens them
	// all again: it offers whichever its last press didn't do.
	let { onfold }: { onfold: (open: boolean) => void } = $props();
	let opens = $state(false);

	function press() {
		onfold(opens);
		opens = !opens;
	}
</script>

<button class="fold-all" aria-label={opens ? 'Expand all files' : 'Collapse all files'} title={opens ? 'Expand all files' : 'Collapse all files'} onclick={press}>
	{#if opens}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
	{:else}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></svg>
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
