<script lang="ts">
	// The small icons drawn in many places, each drawn one way: a cross to
	// close, a chevron that turns down as what it heads opens, and the down
	// chevron of a menu.
	const ICONS = {
		close: { d: 'M6 6l12 12M18 6 6 18', stroke: 2, round: true },
		chevron: { d: 'M9 6l6 6-6 6', stroke: 2, round: false },
		down: { d: 'M6 9l6 6 6-6', stroke: 2.2, round: true }
	};

	let { name, size = 16, turned = false, class: className }: { name: keyof typeof ICONS; size?: number; turned?: boolean; class?: string } = $props();
	const icon = $derived(ICONS[name]);
</script>

<svg
	class={className}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={icon.stroke}
	stroke-linecap={icon.round ? 'round' : undefined}
	stroke-linejoin={name === 'down' ? 'round' : undefined}
	style:transform={turned ? 'rotate(90deg)' : undefined}
	aria-hidden="true"><path d={icon.d} /></svg
>
