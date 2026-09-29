<script lang="ts">
	import { onMount } from 'svelte';
	import { listModels } from '../../api/client';
	import { modelLabel } from '$lib/features/panel/panel.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import type { ModelOption } from '$lib/types';
	import Menu from '$lib/ui/Menu.svelte';

	// This review's model, changeable for it alone. Until it's first prepared
	// it follows the start page's.
	const session = useSession();
	let options = $state<ModelOption[]>([]);
	let fallback = $state('');

	onMount(() => {
		listModels()
			.then((m) => {
				options = m.options;
				fallback = m.selected;
			})
			.catch(() => {});
	});

	const current = $derived(session.model ?? fallback);
	const label = $derived(options.find((o) => o.id === current)?.label ?? (current ? modelLabel(current) : ''));
	const groups = $derived(
		Object.entries(Object.groupBy(options, (o) => o.source)).map(([heading, items]) => ({
			heading,
			items: (items ?? []).map((o) => ({ value: o.id, label: o.label }))
		}))
	);

	function choose(id: string) {
		if (id !== session.model) session.setModel(id);
	}
</script>

{#if label}
	<Menu {groups} value={current} onchoose={choose} label="This review's model" note="For this review only" width={242} placement="outside">
		{#snippet trigger({ open, toggle })}
			<button class="trigger" aria-haspopup="menu" aria-expanded={open} title="The model this review uses" onclick={toggle}>
				{label}
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
			</button>
		{/snippet}
	</Menu>
{/if}

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 6px;
		margin: 0 -6px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--muted);
		font: inherit;
		cursor: pointer;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		color: var(--text);
		background: var(--surface-2);
	}
</style>
