<script lang="ts">
	import { onMount } from 'svelte';
	import { listModels, selectModel } from '$lib/api';
	import type { ModelOption } from '$lib/types';

	// Which model Docent uses, from those available right now. Anything wrong
	// with a provider shows on the Settings page, not here.

	let models = $state<{ options: ModelOption[]; selected: string } | null>(null);
	let saving = $state(false);

	onMount(() => {
		listModels()
			.then((s) => (models = s))
			.catch(() => {});
	});

	async function choose(model: string) {
		if (!models) return;
		saving = true;
		try {
			models.selected = await selectModel(model);
		} catch {
			// The menu keeps showing what's actually in use.
		} finally {
			saving = false;
		}
	}

	const groups = $derived(Object.entries(Object.groupBy(models?.options ?? [], (o) => o.source)));
</script>

{#if models?.options.length}
	<label class="picker">
		<span class="faint">Model</span>
		<select value={models.selected} disabled={saving} onchange={(e) => choose(e.currentTarget.value)}>
			{#each groups as [source, options] (source)}
				<optgroup label={source}>
					{#each options ?? [] as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
				</optgroup>
			{/each}
		</select>
	</label>
{/if}

<style>
	.picker {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 300px;
		font-size: 13.5px;
	}
	select {
		flex-grow: 1;
		min-width: 0;
		height: 34px;
		padding: 0 10px;
		border: 0;
		border-radius: 9px;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font-family: var(--mono);
		font-size: 12.5px;
	}
</style>
