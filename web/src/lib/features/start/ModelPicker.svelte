<script lang="ts">
	import { onMount } from 'svelte';
	import { listModels, selectModel } from '../../api/client';
	import { modelLabel } from '$lib/features/panel/panel.svelte';
	import type { ModelOption } from '$lib/types';
	import Menu from '$lib/ui/Menu.svelte';

	// Which model Docent uses, from those available right now. Anything wrong
	// with a provider shows on the Settings page, not here.

	let models = $state<{ options: ModelOption[]; selected: string } | null>(null);

	onMount(() => {
		listModels()
			.then((s) => (models = s))
			.catch(() => {});
	});

	async function choose(model: string) {
		if (!models || model === models.selected) return;
		const previous = models.selected;
		models.selected = model;
		models.selected = await selectModel(model).catch(() => previous);
	}

	const groups = $derived(
		Object.entries(Object.groupBy(models?.options ?? [], (o) => o.source)).map(([heading, options]) => ({
			heading,
			items: (options ?? []).map((o) => ({ value: o.id, label: o.label }))
		}))
	);
	const current = $derived(models?.options.find((o) => o.id === models?.selected));
</script>

{#if models?.options.length}
	<Menu {groups} value={models.selected} onchoose={choose} label="Model" width={252} placement="end">
		{#snippet trigger({ open, toggle })}
			<button class="trigger" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
				<span class="faint">Model</span>
				<span class="name">{current?.label ?? modelLabel(models!.selected)}</span>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
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
		background: none;
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
