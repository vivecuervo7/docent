<script lang="ts" generics="V extends string">
	import type { Snippet } from 'svelte';

	// A choice of a few options shown side by side, the chosen one filled.
	// As `tabs` it switches what's shown beneath rather than setting a value.
	let {
		options,
		value,
		onchange,
		label,
		small = false,
		tabs = false,
		after
	}: {
		options: { value: V; label: string; disabled?: boolean; title?: string }[];
		value: V;
		onchange: (value: V) => void;
		label: string;
		small?: boolean;
		tabs?: boolean;
		// Shown after an option's label, such as whether it's set up.
		after?: Snippet<[V]>;
	} = $props();
</script>

<div class="segmented" class:small role={tabs ? 'tablist' : 'group'} aria-label={label}>
	{#each options as option (option.value)}
		<button
			class:on={value === option.value}
			role={tabs ? 'tab' : undefined}
			aria-selected={tabs ? value === option.value : undefined}
			aria-pressed={tabs ? undefined : value === option.value}
			disabled={option.disabled}
			title={option.title}
			onclick={() => onchange(option.value)}
		>
			{option.label}
			{#if after}{@render after(option.value)}{/if}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: flex;
		align-self: flex-start;
		padding: 2px;
		border-radius: 10px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	button {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 14px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	button:hover {
		color: var(--text);
	}
	button.on {
		background: #ece8df;
		color: #141413;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.small {
		border-radius: 9px;
	}
	.small button {
		height: 26px;
		padding: 0 11px;
		border-radius: 7px;
		font-size: 12.5px;
	}
</style>
