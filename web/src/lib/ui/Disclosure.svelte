<script lang="ts">
	// A heading that shows or hides what's under it, with how many are there:
	// small capitals to sit among lists, or a serif heading to lead a section.
	// The page shows what's under it while `open`.
	let {
		open = $bindable(false),
		label,
		count,
		look = 'caps'
	}: { open?: boolean; label: string; count?: number; look?: 'caps' | 'heading' } = $props();
</script>

<button class="disclosure {look}" aria-expanded={open} onclick={() => (open = !open)}>
	<svg
		width={look === 'caps' ? 13 : 14}
		height={look === 'caps' ? 13 : 14}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		style:transform={open ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg
	>
	{label}
	{#if count !== undefined}<span class="count">{look === 'caps' ? `(${count})` : count}</span>{/if}
</button>

<style>
	.disclosure {
		display: flex;
		align-items: center;
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		cursor: pointer;
	}
	.disclosure:hover {
		color: var(--text);
	}
	.caps {
		gap: 8px;
		color: var(--faint);
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	.caps .count {
		font-family: var(--mono);
		letter-spacing: 0;
	}
	.heading {
		gap: 10px;
		color: var(--muted);
		font-family: var(--serif);
		font-size: 19px;
		font-weight: 500;
	}
	.heading .count {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--faint);
	}
</style>
