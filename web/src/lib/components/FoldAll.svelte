<script lang="ts">
	// Opens or closes every file on the page at once.
	let { onfold }: { onfold: (open: boolean) => void } = $props();
</script>

<div class="fold-all">
	<button class="btn icon-btn" aria-label="Expand all files" title="Expand all files" onclick={() => onfold(true)}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
	</button>
	<button class="btn icon-btn" aria-label="Collapse all files" title="Collapse all files" onclick={() => onfold(false)}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></svg>
	</button>
</div>

<style>
	.fold-all {
		display: flex;
		gap: 4px;
	}
	.icon-btn {
		width: 32px;
		padding: 0;
		justify-content: center;
	}
</style>
