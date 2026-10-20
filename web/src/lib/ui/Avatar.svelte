<script lang="ts">
	// Someone's GitHub picture, round; their initial while there's none.
	let { src, name, size = 20 }: { src?: string; name: string; size?: number } = $props();
	let failed = $state(false);
</script>

{#if src && !failed}
	<img class="avatar" src="{src}{src.includes('?') ? '&' : '?'}s={size * 2}" alt="" width={size} height={size} onerror={() => (failed = true)} />
{:else}
	<span class="avatar initial" style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.5)}px" aria-hidden="true"
		>{name.slice(0, 1).toUpperCase()}</span
	>
{/if}

<style>
	.avatar {
		flex-shrink: 0;
		border-radius: 50%;
		box-shadow: 0 0 0 1px var(--line-2);
	}
	.initial {
		display: inline-grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--muted);
		font-weight: 500;
	}
</style>
