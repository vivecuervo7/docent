<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import Menu from './Menu.svelte';

	// A choice from a short list as a form field, drawn in the app's style
	// rather than the browser's.
	let { value = $bindable(), options, label }: { value: string; options: { value: string; label: string }[]; label: string } = $props();

	const current = $derived(options.find((o) => o.value === value) ?? options[0]);
</script>

<Menu groups={[{ items: options }]} {value} onchoose={(v) => (value = v)} {label} width="trigger">
	{#snippet trigger({ open, toggle })}
		<button type="button" class="trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onclick={toggle}>
			<span>{current?.label}</span>
			<Icon name="down" size={14} />
		</button>
	{/snippet}
</Menu>

<style>
	.trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-width: 220px;
		height: 36px;
		padding: 0 12px 0 14px;
		border: 0;
		border-radius: 9px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
	}
	.trigger :global(svg) {
		color: var(--faint);
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		box-shadow: inset 0 0 0 1px var(--you);
	}
</style>
