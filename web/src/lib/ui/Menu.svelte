<script lang="ts" generics="V extends string">
	import type { Snippet } from 'svelte';

	// A menu of choices under a trigger the caller draws: grouped options, the
	// current one ticked, each with an optional hint. It closes on a choice, a
	// click elsewhere, or Escape. `agent` gives it the panel's amber tones.
	let {
		groups,
		value,
		onchoose,
		label,
		note,
		tone = 'plain',
		width = 220,
		placement = 'start',
		trigger
	}: {
		groups: { heading?: string; items: { value: V; label: string; hint?: string }[] }[];
		value: V | undefined;
		onchoose: (value: V) => void;
		label: string;
		// A line above the options, such as what choosing here affects.
		note?: string;
		tone?: 'plain' | 'agent';
		// Its least width, padding included; `trigger` matches the trigger's.
		width?: number | 'trigger';
		// Lined up with the trigger's start, just outside it, or its end.
		placement?: 'start' | 'outside' | 'end';
		trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLSpanElement | null>(null);

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root?.contains(e.target as Node)) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

<span class="root" bind:this={root}>
	{@render trigger({ open, toggle: () => (open = !open) })}
	{#if open}
		<div class="menu {tone} {placement}" role="menu" aria-label={label} style:min-width={width === 'trigger' ? '100%' : `${width}px`}>
			{#if note}<span class="note">{note}</span>{/if}
			{#each groups as group, i (i)}
				{#if group.heading}<span class="group">{group.heading}</span>{/if}
				{#each group.items as item (item.value)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={item.value === value}
						onclick={() => {
							open = false;
							onchoose(item.value);
						}}
					>
						<span class="tick">{#if item.value === value}✓{/if}</span>
						<span>{item.label}</span>
						{#if item.hint}<span class="hint">{item.hint}</span>{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</span>

<style>
	.root {
		position: relative;
		display: inline-block;
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		max-height: 70vh;
		overflow-y: auto;
		padding: 6px;
		box-sizing: border-box;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.start {
		left: 0;
	}
	.outside {
		left: -8px;
	}
	.end {
		right: 0;
	}
	.note {
		padding: 6px 10px 2px;
		font-size: 12px;
		color: var(--faint);
	}
	.group {
		padding: 8px 10px 4px;
		font-size: 11px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) auto;
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
	button:hover {
		background: var(--line-2);
	}
	.tick {
		color: var(--done);
		font-size: 13px;
	}
	.hint {
		font-size: 12px;
		color: var(--faint);
	}
	.agent {
		background: #221e17;
		box-shadow:
			0 0 0 1px #3a3226,
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
	}
	.agent button:hover {
		background: #2e281e;
	}
	.agent .tick {
		color: var(--agent);
	}
</style>
