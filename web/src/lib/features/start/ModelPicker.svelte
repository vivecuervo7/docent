<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import { onMount } from 'svelte';
	import { listModels, selectModel } from '../../api/client';
	import { modelLabel } from '$lib/features/panel/panel.svelte';
	import type { ModelOption } from '$lib/types';
	import Menu from '$lib/ui/Menu.svelte';

	// Which model Docent uses, from those available right now. Anything wrong
	// with a provider shows on the Settings page, not here.

	// The menu as last seen in this browser, so it's there from the first
	// paint rather than appearing once the models are listed.
	const KEPT = 'docent.models';
	let models = $state<{ options: ModelOption[]; selected: string } | null>(kept());

	function kept() {
		try {
			return JSON.parse(localStorage.getItem(KEPT) ?? 'null');
		} catch {
			return null;
		}
	}

	onMount(() => {
		listModels()
			.then((s) => {
				models = s;
				try {
					localStorage.setItem(KEPT, JSON.stringify(s));
				} catch {
					// Not kept: the menu waits for the list next time.
				}
			})
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
	// A provider's model looks through the code with tool calls, which not every model supports.
	const hasProviderModels = $derived((models?.options ?? []).some((o) => o.source !== 'Claude Code' && o.source !== 'Codex'));
</script>

{#if models?.options.length}
	<Menu
		{groups}
		value={models.selected}
		onchoose={choose}
		label="Model"
		width={252}
		placement="end"
		note={hasProviderModels ? 'Outside Claude Code and Codex, follow-ups and thread checks use tool calls. A model that doesn’t support them will error.' : undefined}
	>
		{#snippet trigger({ open, toggle })}
			<button class="trigger" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
				<span class="faint">Model</span>
				<span class="name">{current?.label ?? modelLabel(models!.selected)}</span>
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
