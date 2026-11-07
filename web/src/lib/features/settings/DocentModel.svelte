<script lang="ts">
	import MenuSelect from '../../ui/MenuSelect.svelte';
	import { chooseModel, loadModels, models } from './models.svelte';

	// The model Docent uses, as the menu at the top chooses it.
	$effect(() => {
		loadModels();
	});
</script>

{#if models.current?.options.length}
	<MenuSelect
		bind:value={() => models.current?.selected ?? '', (model) => chooseModel(model)}
		label="Docent's model"
		filter="Filter models…"
		listWidth={360}
		options={models.current.options.map((o) => ({ value: o.id, label: o.label, group: o.source }))}
	/>
{/if}
