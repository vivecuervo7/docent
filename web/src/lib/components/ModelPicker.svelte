<script lang="ts">
	import { onMount } from 'svelte';
	import { listModels, selectModel } from '$lib/api';
	import { modelLabel } from '$lib/panel.svelte';
	import type { ModelOption } from '$lib/types';

	// Which model Docent uses, from those available right now. Anything wrong
	// with a provider shows on the Settings page, not here.

	let models = $state<{ options: ModelOption[]; selected: string } | null>(null);
	let open = $state(false);

	onMount(() => {
		listModels()
			.then((s) => (models = s))
			.catch(() => {});
	});

	async function choose(model: string) {
		open = false;
		if (!models || model === models.selected) return;
		const previous = models.selected;
		models.selected = model;
		models.selected = await selectModel(model).catch(() => previous);
	}

	const groups = $derived(Object.entries(Object.groupBy(models?.options ?? [], (o) => o.source)));
	const current = $derived(models?.options.find((o) => o.id === models?.selected));

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.model')) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

{#if models?.options.length}
	<div class="model">
		<button class="trigger" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="faint">Model</span>
			<span class="name">{current?.label ?? modelLabel(models.selected)}</span>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
		</button>
		{#if open}
			<div class="menu" role="menu" aria-label="Model">
				{#each groups as [source, options] (source)}
					<span class="group">{source}</span>
					{#each options ?? [] as o (o.id)}
						<button role="menuitemradio" aria-checked={o.id === models.selected} onclick={() => choose(o.id)}>
							<span class="tick">{#if o.id === models.selected}✓{/if}</span>
							<span>{o.label}</span>
						</button>
					{/each}
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.model {
		position: relative;
	}
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
	.menu {
		position: absolute;
		z-index: 10;
		top: calc(100% + 6px);
		right: 0;
		min-width: 240px;
		max-height: 70vh;
		overflow-y: auto;
		padding: 6px;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.group {
		padding: 8px 10px 4px;
		font-size: 11px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	.menu button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		height: 34px;
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
