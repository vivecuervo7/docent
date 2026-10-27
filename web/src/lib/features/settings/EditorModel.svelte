<script lang="ts">
	import { readOk, sendJson } from '../../api/client';
	import type { ModelOption } from '$lib/types';
	import MenuSelect from '../../ui/MenuSelect.svelte';

	// The model the panel's editor groups and checks findings with.
	let options = $state<ModelOption[]>([]);
	let value = $state('');
	let saved = '';

	$effect(() => {
		fetch('/api/editor-model')
			.then((res) => readOk<{ options: ModelOption[]; selected: string }>(res))
			.then((r) => {
				options = r.options;
				value = saved = r.selected;
			})
			.catch(() => {});
	});

	$effect(() => {
		if (!value || value === saved) return;
		saved = value;
		sendJson('/api/editor-model', { model: value }, 'PUT').catch(() => {});
	});
</script>

{#if options.length}
	<MenuSelect bind:value label="Editor model" options={options.map((o) => ({ value: o.id, label: `${o.label} · ${o.source}` }))} />
{/if}
