<script lang="ts">
	import { THEMES, THEME_LABELS, type Theme } from './stats';

	// What the kept findings were about, theme by theme, as one ring.
	let { counts }: { counts: Partial<Record<Theme, number>> } = $props();

	// Muted, as the page's other bars are.
	const COLOURS: Record<Theme, string> = {
		correctness: '#6f9679',
		reliability: '#687c9c',
		security: '#a87670',
		tests: '#9a8660',
		design: '#7e7598',
		build: '#5f6168'
	};
	const R = 52;
	const C = 2 * Math.PI * R;

	const total = $derived(THEMES.reduce((a, t) => a + (counts[t] ?? 0), 0));
	const slices = $derived.by(() => {
		let at = 0;
		return THEMES.filter((t) => counts[t])
			.sort((a, b) => counts[b]! - counts[a]!)
			.map((t) => {
				const share = counts[t]! / total;
				const slice = { theme: t, count: counts[t]!, share, offset: at };
				at += share;
				return slice;
			});
	});
	let pointed = $state<Theme | null>(null);
</script>

<div class="pie">
	<svg viewBox="0 0 140 140" role="img" aria-label="Kept findings by theme">
		{#each slices as s (s.theme)}
			<circle
				cx="70"
				cy="70"
				r={R}
				stroke={COLOURS[s.theme]}
				stroke-dasharray="{s.share * C} {C}"
				stroke-dashoffset={-s.offset * C}
				class:dim={pointed && pointed !== s.theme}
				role="presentation"
				onpointerenter={() => (pointed = s.theme)}
				onpointerleave={() => (pointed = null)}
			/>
		{/each}
		<text x="70" y="70" text-anchor="middle" class="total">{total}</text>
		<text x="70" y="86" text-anchor="middle" class="unit">kept</text>
	</svg>
	<ul>
		{#each slices as s (s.theme)}
			<li class:dim={pointed && pointed !== s.theme} onpointerenter={() => (pointed = s.theme)} onpointerleave={() => (pointed = null)}>
				<span class="swatch" style:background={COLOURS[s.theme]}></span>
				<span>{THEME_LABELS[s.theme]}</span>
				<span class="faint">{s.count} · {Math.round(s.share * 100)}%</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.pie {
		display: flex;
		align-items: center;
		gap: 32px;
		padding: 16px 20px;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	svg {
		width: 140px;
		flex-shrink: 0;
		transform: rotate(-90deg);
	}
	circle {
		fill: none;
		stroke-width: 18;
		transition: opacity 120ms;
	}
	text {
		transform: rotate(90deg);
		transform-origin: 70px 70px;
	}
	.total {
		fill: var(--text);
		font-family: var(--serif);
		font-size: 24px;
	}
	.unit {
		fill: var(--faint);
		font-size: 11px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13.5px;
	}
	li {
		display: grid;
		grid-template-columns: 10px 140px auto;
		align-items: center;
		gap: 10px;
		transition: opacity 120ms;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.dim {
		opacity: 0.35;
	}
</style>
