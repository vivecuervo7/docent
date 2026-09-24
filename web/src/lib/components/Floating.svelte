<script lang="ts">
	import { arrow, autoUpdate, computePosition, flip, offset, shift, size, type Placement, type ReferenceElement } from '@floating-ui/dom';
	import type { Snippet } from 'svelte';

	// A bubble anchored to something on the page: beside it when there's room
	// (in the margin right of the diff), else on the other side, over the code.
	// It stays within the window, and scrolls inside when it's too tall.
	let {
		anchor,
		placement = 'right-start',
		fallback = ['left-start'],
		pointer = true,
		tone = 'plain',
		label,
		children
	}: {
		anchor: ReferenceElement | null;
		placement?: Placement;
		fallback?: Placement[];
		// Show an arrow pointing at the anchor.
		pointer?: boolean;
		// An agent's finding sits on the agent's brown.
		tone?: 'plain' | 'agent';
		label: string;
		children: Snippet;
	} = $props();

	let bubble = $state<HTMLDivElement | null>(null);
	let tip = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!anchor || !bubble) return;
		const el = bubble;
		// Clear of the window's edges, and of the sticky top bar.
		const room = { top: 76, right: 12, bottom: 12, left: 12 };
		const update = () =>
			computePosition(anchor!, el, {
				strategy: 'fixed',
				placement,
				middleware: [
					// Starting a little above its anchor sets the arrow in from the corner.
					offset(pointer ? { mainAxis: 26, alignmentAxis: -18 } : 6),
					flip({ fallbackPlacements: fallback, padding: room }),
					shift({ padding: room }),
					size({
						padding: room,
						apply: ({ availableHeight }) => {
							el.style.maxHeight = `${Math.max(160, availableHeight)}px`;
						}
					}),
					...(pointer && tip ? [arrow({ element: tip, padding: 14 })] : [])
				]
			}).then(({ x, y, placement: placed, middlewareData }) => {
				Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
				if (tip && middlewareData.arrow) {
					const side = placed.split('-')[0];
					const { x: ax, y: ay } = middlewareData.arrow;
					const outside = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }[side]!;
					Object.assign(tip.style, {
						left: ax != null ? `${ax}px` : '',
						top: ay != null ? `${ay}px` : '',
						right: '',
						bottom: '',
						[outside]: '-18px'
					});
					tip.dataset.side = side;
				}
			});
		return autoUpdate(anchor, el, update);
	});
</script>

<div bind:this={bubble} class="floating popover {tone}" role="dialog" aria-label={label} tabindex="-1">
	{#if pointer}<div bind:this={tip} class="tip" aria-hidden="true"></div>{/if}
	{@render children()}
</div>

<style>
	.floating {
		position: fixed;
		z-index: 40;
		left: 0;
		top: 0;
		display: flex;
		flex-direction: column;
		width: 440px;
		max-width: calc(100vw - 24px);
		box-sizing: border-box;
		border-radius: 14px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 30px 70px -20px rgba(0, 0, 0, 0.7);
		font-family: var(--sans);
		white-space: normal;
		cursor: auto;
		outline: none;
	}
	.floating.agent {
		--bubble: var(--popover);
		--bubble-line: var(--popover-line);
		background: var(--popover);
		box-shadow:
			0 0 0 1px var(--popover-line),
			0 30px 70px -20px rgba(0, 0, 0, 0.7);
	}
	/* A long, narrow pointer, so the bubble stands off the diff's edge. */
	.tip {
		position: absolute;
		width: 18px;
		height: 14px;
		background: var(--bubble, var(--surface-2));
		clip-path: polygon(0 0, 100% 50%, 0 100%);
	}
	.floating :global(.tip[data-side='right']) {
		transform: rotate(180deg);
	}
	.floating :global(.tip[data-side='top']) {
		transform: rotate(90deg);
	}
	.floating :global(.tip[data-side='bottom']) {
		transform: rotate(-90deg);
	}
</style>
