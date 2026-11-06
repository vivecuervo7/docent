<script lang="ts">
	// The small icons drawn in many places, each drawn one way: a cross to
	// close, a chevron that turns down as what it heads opens, the down
	// chevron of a menu, and the pages beside home.
	const ICONS = {
		close: { d: 'M6 6l12 12M18 6 6 18', stroke: 2, round: true },
		chevron: { d: 'M9 6l6 6-6 6', stroke: 2, round: false },
		down: { d: 'M6 9l6 6 6-6', stroke: 2.2, round: true },
		book: { d: 'M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5zM5 19.5A2.5 2.5 0 0 0 7.5 22H19v-5', stroke: 1.7, round: true },
		chart: { d: 'M4 4v16h16M8.5 16v-5M12.5 16V8M16.5 16v-3', stroke: 1.7, round: true },
		sliders: { d: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', stroke: 1.7, round: true }
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
	stroke-linejoin={icon.round ? 'round' : undefined}
	style:transform={turned ? 'rotate(90deg)' : undefined}
	aria-hidden="true"><path d={icon.d} /></svg
>
