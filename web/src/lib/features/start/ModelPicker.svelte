<script lang="ts">
	import Icon from '#lib/ui/Icon.svelte';
	import { onMount } from 'svelte';
	import { modelLabel } from '#lib/features/panel/panel.svelte.js';
	import { chooseModel, loadModels, models } from '#lib/features/settings/models.svelte.js';
	import Menu from '#lib/ui/Menu.svelte';

	// Which model Docent uses, from those available right now. Anything wrong
	// with a provider shows on the Settings page, not here.
	onMount(() => {
		loadModels();
	});

	const groups = $derived(
		Object.entries(Object.groupBy(models.current?.options ?? [], (o) => o.source)).map(([heading, options]) => ({
			heading,
			items: (options ?? []).map((o) => ({ value: o.id, label: o.label }))
		}))
	);
	const current = $derived(models.current?.options.find((o) => o.id === models.current?.selected));
</script>

{#if models.current?.options.length}
	<Menu {groups} value={models.current.selected} onchoose={chooseModel} label="Model" filter="Filter models…" width={300} placement="end">
		{#snippet trigger({ open, toggle })}
			<button class="trigger" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
				<span class="faint">Model</span>
				<span class="name">{current?.label ?? modelLabel(models.current?.selected ?? '')}</span>
				<Icon name="down" size={14} />
			</button>
		{/snippet}
	</Menu>
{/if}

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border: 0;
		border-radius: 8px;
		background: color-mix(in srgb, var(--surface-2) 50%, transparent);
		color: var(--muted);
		font: inherit;
		font-size: 13.5px;
		cursor: pointer;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		color: var(--text);
		background: var(--surface-2);
	}
	.name {
		color: var(--text);
	}
</style>
