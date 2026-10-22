<script lang="ts">
	import type { Snippet } from 'svelte';

	// A centred card over a dimmed page. Escape or a click on the dimmed
	// area closes it. It's moved to the end of the page, so one opened from
	// inside another sits over it, and Escape closes only the top one.
	let { label, width = 660, onclose, children }: { label: string; width?: number; onclose: () => void; children: Snippet } = $props();

	let card: HTMLElement;
	const onTop = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1) === card;
	function toBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onTop() && onclose()} />

<div class="scrim" role="presentation" onclick={onclose} use:toBody></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label={label} style:width="{width}px" bind:this={card} use:toBody>
	{@render children()}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(12, 13, 15, 0.72);
	}
	.dialog {
		position: fixed;
		z-index: 51;
		left: 50%;
		top: 96px;
		transform: translateX(-50%);
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 128px);
		overflow-y: auto;
		box-sizing: border-box;
		padding: 28px 28px 24px;
		border-radius: 20px;
		background: var(--surface);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 40px 90px -30px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
