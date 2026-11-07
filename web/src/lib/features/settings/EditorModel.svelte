<script lang="ts">
	import { readOk, sendJson } from '../../api/client';
	import MenuSelect from '../../ui/MenuSelect.svelte';
	import { loadModels, models } from './models.svelte';

	// The model the panel's editor groups and checks findings with, from the
	// same models Docent can use.
	let value = $state('');
	let saved = '';
	// Choices made so far, so a reading that started before the latest one
	// can't put the old model back.
	let picks = 0;

	$effect(() => {
		loadModels();
	});
	// Read again whenever the models or Docent's choice change: one it was set
	// to can go with its provider, and unset, it can follow Docent's model.
	$effect(() => {
		void models.current?.selected;
		const at = picks;
		fetch('/api/editor-model')
			.then((res) => readOk<{ selected: string }>(res))
			.then((r) => {
				if (at === picks) value = saved = r.selected;
			})
			.catch(() => {});
	});

	$effect(() => {
		if (!value || value === saved) return;
		saved = value;
		picks++;
		sendJson('/api/editor-model', { model: value }, 'PUT').catch(() => {});
	});
</script>

{#if models.current?.options.length}
	<MenuSelect
		bind:value
		label="Editor model"
		filter="Filter models…"
		listWidth={360}
		options={models.current.options.map((o) => ({ value: o.id, label: o.label, group: o.source }))}
	/>
{/if}
