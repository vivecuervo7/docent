<script lang="ts">
	import MarkIcon from './MarkIcon.svelte';

	// A mark's pin beside the code: a finding in amber, a thread in blue,
	// outlined when the finding is skipped, with a dot while something in it
	// is new to read. `id` lets the bubble it opens find it.
	let {
		kind,
		id,
		label,
		title,
		skipped = false,
		active = false,
		unread = false,
		unreadLabel = 'New to read',
		onclick,
		onpointerenter,
		onpointerleave
	}: {
		kind: 'finding' | 'note';
		id?: string;
		label: string;
		title?: string;
		skipped?: boolean;
		active?: boolean;
		unread?: boolean;
		unreadLabel?: string;
		onclick: () => void;
		onpointerenter?: () => void;
		onpointerleave?: () => void;
	} = $props();
</script>

<button
	class="pin {kind}"
	class:skipped
	class:active
	data-pin={id}
	aria-label={label}
	title={title ?? label}
	{onclick}
	{onpointerenter}
	{onpointerleave}
>
	<MarkIcon {kind} />
	{#if unread}<span class="unread" aria-label={unreadLabel}></span>{/if}
</button>

<style>
	.pin {
		position: relative;
		display: grid;
		place-items: center;
		width: 20px;
		height: 18px;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.pin.finding {
		fill: var(--agent);
	}
	/* Skipped, or suggested for skipping: the same diamond, outlined. */
	.pin.finding.skipped {
		fill: none;
		stroke: var(--agent);
		stroke-width: 1.2;
		opacity: 0.75;
	}
	.pin.note {
		fill: var(--you);
	}
	.pin.active,
	.pin:hover {
		filter: brightness(1.3);
	}
	.unread {
		position: absolute;
		top: -2px;
		right: 0;
		width: 7px;
		height: 7px;
		border-radius: 4px;
		background: var(--you);
		box-shadow: 0 0 0 2px var(--code-bg);
	}
</style>
