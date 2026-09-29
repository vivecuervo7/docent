<script lang="ts">
	import type { Snippet } from 'svelte';

	// A labelled form field: the label, the control given as children (an
	// input, a textarea, or any control such as a menu), and an optional hint
	// beneath. Inputs and textareas inside take the form's look. A single
	// input or textarea sits inside the label; a control that isn't one, such
	// as a menu's button, sits beside it with `element="div"`, and `for` names
	// the input the label is for.
	let {
		label,
		hint,
		element = 'label',
		for: forId,
		children
	}: { label: string; hint?: string | Snippet; element?: 'label' | 'div'; for?: string; children: Snippet } = $props();
</script>

<svelte:element this={element} class="field">
	{#if element === 'div' && forId}<label for={forId}>{label}</label>{:else}<span>{label}</span>{/if}
	{@render children()}
	{#if typeof hint === 'string'}
		<small>{hint}</small>
	{:else if hint}
		<small>{@render hint()}</small>
	{/if}
</svelte:element>

<style>
	.field {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
		font-size: 13px;
		color: var(--muted);
	}
	div.field {
		align-items: flex-start;
	}
	.field :global(input:not([type='checkbox'])),
	.field :global(textarea) {
		height: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: 9px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		outline: none;
	}
	div.field > :global(input:not([type='checkbox'])) {
		align-self: stretch;
	}
	.field :global(textarea) {
		height: auto;
		min-height: 36px;
		box-sizing: border-box;
		padding: 7px 12px;
		resize: vertical;
		field-sizing: content;
		line-height: 1.5;
	}
	.field :global(input:focus),
	.field :global(textarea:focus) {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.field :global(input:disabled) {
		opacity: 0.5;
	}
	.field :global(input.mono) {
		font-family: var(--mono);
		font-size: 13px;
	}
	small {
		color: var(--faint);
		font-size: 12.5px;
		line-height: 1.5;
	}
</style>
