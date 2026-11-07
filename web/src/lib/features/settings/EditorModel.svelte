<script lang="ts">
	import { readOk, sendJson } from '../../api/client';
	import MenuSelect from '../../ui/MenuSelect.svelte';
	import { loadModels, models } from './models.svelte';

	// The model the panel's editor groups and checks findings with, from the
	// same models Docent can use.
	let value = $state('');
	let saved = '';

	$effect(() => {
		loadModels();
		fetch('/api/editor-model')
			.then((res) => readOk<{ selected: string }>(res))
			.then((r) => (value = saved = r.selected))
			.catch(() => {});
	});

	$effect(() => {
		if (!value || value === saved) return;
		saved = value;
		sendJson('/api/editor-model', { model: value }, 'PUT').catch(() => {});
	});
</script>

{#if models.current?.options.length && value}
	<MenuSelect
		bind:value
		label="Editor model"
		filter="Filter models…"
		listWidth={360}
		options={models.current.options.map((o) => ({ value: o.id, label: o.label, group: o.source }))}
	/>
{/if}
