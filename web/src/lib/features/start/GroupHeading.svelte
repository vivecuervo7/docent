<script lang="ts">
	// A heading per repo or author on the start page: the repo linking to its
	// pull requests on GitHub, or the author with their avatar, how many PRs
	// are under it, and folding them away.
	let {
		label,
		count,
		byRepo,
		folded,
		ontoggle
	}: { label: string; count: number; byRepo: boolean; folded: boolean; ontoggle: () => void } = $props();
</script>

<h3 class="group">
	{#if byRepo}
		<a class="group-link" href="https://github.com/{label}/pulls" target="_blank" rel="noreferrer" title="{label}’s pull requests on GitHub">
			<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
				><path
					fill="currentColor"
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/></svg
			>
			{label}
		</a>
	{:else if label !== 'Author not known yet'}
		<img class="avatar" src="https://github.com/{label}.png?size=48" alt="" width="20" height="20" loading="lazy" />
		{label}
	{:else}
		{label}
	{/if}
	<span class="count">{count}</span>
	<button class="fold" aria-expanded={!folded} aria-label="{folded ? 'Show' : 'Fold'} {label}" title="{folded ? 'Show' : 'Fold'} {label}" onclick={ontoggle}>
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={folded ? '' : 'rotate(90deg)'}><path d="M9 6l6 6-6 6" /></svg>
	</button>
</h3>

<style>
	.group {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 26px 0 8px;
		font-size: 14px;
		font-weight: 500;
		color: var(--text);
	}
	.group-link {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: inherit;
		text-decoration: none;
	}
	.group-link svg {
		color: var(--muted);
	}
	.group-link:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.avatar {
		border-radius: 50%;
		background: var(--surface-2);
	}
	.count {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 400;
		color: var(--faint);
	}
	.fold {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		margin-left: -2px;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--faint);
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
	}
</style>
