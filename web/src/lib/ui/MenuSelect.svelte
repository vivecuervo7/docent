<script lang="ts">
	// A choice from a short list, drawn in the app's style rather than the
	// browser's.
	let {
		value = $bindable(),
		options,
		label
	}: { value: string; options: { value: string; label: string }[]; label: string } = $props();

	let open = $state(false);
	let root = $state<HTMLDivElement | null>(null);
	const current = $derived(options.find((o) => o.value === value) ?? options[0]);

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root?.contains(e.target as Node)) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

<div class="select" bind:this={root}>
	<button type="button" class="trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onclick={() => (open = !open)}>
		<span>{current?.label}</span>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
	</button>
	{#if open}
		<div class="menu" role="listbox" aria-label={label}>
			{#each options as o (o.value)}
				<button
					type="button"
					role="option"
					aria-selected={o.value === value}
					onclick={() => {
						value = o.value;
						open = false;
					}}
				>
					<span class="tick">{#if o.value === value}✓{/if}</span>
					<span>{o.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.select {
		position: relative;
		display: inline-block;
	}
	.trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-width: 220px;
		height: 36px;
		padding: 0 12px 0 14px;
		border: 0;
		border-radius: 9px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
	}
	.trigger svg {
		color: var(--faint);
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		left: 0;
		min-width: 100%;
		padding: 6px;
		box-sizing: border-box;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.menu button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--line-2);
	}
	.tick {
		color: var(--done);
		font-size: 13px;
	}
</style>
