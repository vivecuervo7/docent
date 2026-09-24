<script lang="ts">
	import { onMount } from 'svelte';
	import { listModels, selectModel } from '$lib/api';
	import type { ModelOption } from '$lib/types';

	// Which model Docent uses: one the endpoint in backend/.env offers, or one
	// of Claude Code's, run through `claude -p` on the reviewer's own login.

	let models = $state<{ options: ModelOption[]; selected: string; error?: string } | null>(null);
	let saving = $state(false);

	onMount(() => {
		listModels()
			.then((s) => (models = s))
			.catch((err) => (models = { options: [], selected: '', error: (err as Error).message }));
	});

	async function choose(model: string) {
		if (!models) return;
		saving = true;
		try {
			models.selected = await selectModel(model);
		} catch (err) {
			models.error = (err as Error).message;
		} finally {
			saving = false;
		}
	}

	const endpoint = $derived(models?.options.filter((o) => o.group === 'endpoint') ?? []);
	const claude = $derived(models?.options.filter((o) => o.group === 'claude-code') ?? []);
	// The one in use stays listed even when nothing offers it now.
	const missing = $derived(!!models?.selected && !models.options.some((o) => o.id === models!.selected));
</script>

{#if models}
	<div class="picker">
		<label>
			<span class="faint">Model</span>
			<select
				value={models.selected}
				disabled={saving || models.options.length + (missing ? 1 : 0) === 0}
				onchange={(e) => choose(e.currentTarget.value)}
			>
				{#if missing}<option value={models.selected}>{models.selected} (unavailable)</option>{/if}
				{#if endpoint.length}
					<optgroup label="Endpoint (backend/.env)">
						{#each endpoint as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
					</optgroup>
				{/if}
				{#if claude.length}
					<optgroup label="Claude Code (your login)">
						{#each claude as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
					</optgroup>
				{/if}
			</select>
		</label>
		{#if models.error}
			<p class="faint">Couldn't list the endpoint's models ({models.error}). Check it's running, and backend/.env.</p>
		{/if}
	</div>
{/if}

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 300px;
	}
	label {
		display: flex;
		align-items: center;
		gap: 12px;
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
	p {
		margin: 0;
		font-size: 12px;
		text-align: right;
	}
</style>
