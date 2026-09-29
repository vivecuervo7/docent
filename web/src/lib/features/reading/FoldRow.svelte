<script lang="ts">
	import HiddenMarks from './HiddenMarks.svelte';
	import type { Row } from './diff/parse';
	import type { Mark } from './marks';

	// A run of quiet code folded to one row - imports, setup, a test's body -
	// saying what's inside while it's closed: its changes, or how many
	// unchanged lines, and any marks on them.
	let {
		rows,
		label,
		open,
		hidden,
		ontoggle
	}: { rows: Row[]; label?: string; open: boolean; hidden: Mark[]; ontoggle: () => void } = $props();

	const added = $derived(rows.filter((r) => r.kind === 'add').length);
	const removed = $derived(rows.filter((r) => r.kind === 'del').length);
</script>

<button class="fold-row" aria-expanded={open} title={`${open ? 'Fold' : 'Show'} ${label ? `the ${label}` : 'this code'}`} onclick={ontoggle}>
	<span class="tab" aria-hidden="true"
		><svg width="9" height="9" viewBox="0 0 24 24" style:transform={open ? 'rotate(90deg)' : ''}><path d="M7 4l12 8-12 8z" fill="currentColor" /></svg></span
	>
	<span class="kind">…</span>
	<!-- The counts say what's hidden, so they go once it's open. -->
	{#if !open}
		{#if added || removed}
			<span class="changes">{#if added}<span class="plus">+{added}</span>{/if} {#if removed}<span class="minus">−{removed}</span>{/if}</span>
		{:else}
			<span class="changes">{rows.length} unchanged lines</span>
		{/if}
	{/if}
	<HiddenMarks marks={open ? [] : hidden} />
</button>

<style>
	.fold-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 28px;
		padding: 0 16px;
		border: 0;
		background: var(--hunk-bg);
		color: var(--muted);
		font-family: var(--sans);
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
	}
	.fold-row:hover {
		color: var(--text);
		background: #202127;
	}
	.kind {
		font-family: var(--mono);
		font-size: 12px;
	}
	.changes {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 12px;
	}
	.plus {
		color: var(--plus-dull);
	}
	.minus {
		color: var(--minus-dull);
	}
	/* Hangs off the block's left edge, so a fold is seen even at a glance. */
	.tab {
		position: absolute;
		left: -20px;
		top: 5px;
		display: grid;
		place-items: center;
		width: 16px;
		height: 18px;
		color: var(--muted);
	}
</style>
