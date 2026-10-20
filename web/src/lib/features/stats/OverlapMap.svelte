<script lang="ts">
	import type { OverlapPair, OverlapReviewer } from './summary';

	// Reviewers as circles sized by the points of theirs you kept, set so
	// each pair overlaps by about the kept points both raised: a circle mostly
	// inside another finds little the other doesn't; one off on its own finds
	// its own. Only reviewers that ran together are drawn together; pointing
	// at one shows all it raised, skipped too, and who it shares points with.
	let { reviewers, pairs }: { reviewers: OverlapReviewer[]; pairs: OverlapPair[] } = $props();

	const WIDTH = 760;
	const HEIGHT = 340;
	const PAD = 28;

	const radius = (points: number) => Math.sqrt(points / Math.PI);
	// How much two circles at a distance overlap, by area.
	function lens(r1: number, r2: number, d: number) {
		if (d >= r1 + r2) return 0;
		if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
		const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
		const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
		const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
		return a + b - c;
	}
	// The distance at which two circles overlap by the given area.
	function apart(r1: number, r2: number, area: number) {
		if (area <= 0) return (r1 + r2) * 1.12;
		if (area >= Math.PI * Math.min(r1, r2) ** 2) return Math.abs(r1 - r2);
		let lo = Math.abs(r1 - r2);
		let hi = r1 + r2;
		for (let i = 0; i < 40; i++) {
			const mid = (lo + hi) / 2;
			if (lens(r1, r2, mid) > area) lo = mid;
			else hi = mid;
		}
		return (lo + hi) / 2;
	}

	// Placed by nudging each pair towards its distance, many times over;
	// reviewers that never ran together only keep clear of each other.
	const layout = $derived.by(() => {
		const nodes = [...reviewers].sort((a, b) => b.kept - a.kept).map((r, i, all) => {
			const angle = (i / all.length) * Math.PI * 2;
			return { ...r, r: radius(r.kept), x: Math.cos(angle), y: Math.sin(angle) };
		});
		const spread = nodes.reduce((a, n) => a + n.r, 0) / 2 || 1;
		for (const n of nodes) {
			n.x *= spread;
			n.y *= spread;
		}
		const pairOf = (a: string, b: string) => pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
		const links = nodes.flatMap((n, i) =>
			nodes.slice(i + 1).map((m) => {
				const p = pairOf(n.id, m.id);
				const together = !!p?.together;
				return { n, m, target: apart(n.r, m.r, together ? p!.shared : 0), weight: together ? 1 : 0.15, together };
			})
		);
		for (let step = 0; step < 400; step++) {
			const rate = 0.5 * (1 - step / 400) + 0.02;
			for (const { n, m, target, weight, together } of links) {
				const dx = m.x - n.x;
				const dy = m.y - n.y;
				const dist = Math.hypot(dx, dy) || 0.001;
				// Apart enough is enough for those that never met.
				if (!together && dist >= target) continue;
				const move = ((dist - target) / dist) * weight * rate * 0.5;
				n.x += dx * move;
				n.y += dy * move;
				m.x -= dx * move;
				m.y -= dy * move;
			}
		}
		const outer = (n: (typeof nodes)[number]) => Math.max(n.r, radius(n.decided));
		const minX = Math.min(...nodes.map((n) => n.x - outer(n)));
		const maxX = Math.max(...nodes.map((n) => n.x + outer(n)));
		const minY = Math.min(...nodes.map((n) => n.y - outer(n)));
		const maxY = Math.max(...nodes.map((n) => n.y + outer(n)));
		const scale = Math.min((WIDTH - PAD * 2) / (maxX - minX || 1), (HEIGHT - PAD * 2) / (maxY - minY || 1));
		const ox = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
		const oy = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;
		return nodes.map((n) => ({ ...n, cx: n.x * scale + ox, cy: n.y * scale + oy, pr: n.r * scale, ring: radius(n.decided) * scale }));
	});

	let pointed = $state<string | null>(null);
	const focus = $derived(layout.find((n) => n.id === pointed));
	const partners = $derived(
		focus
			? pairs
					.filter((p) => (p.a === focus.id || p.b === focus.id) && p.shared > 0)
					.map((p) => ({ id: p.a === focus.id ? p.b : p.a, shared: p.shared }))
					.sort((a, b) => b.shared - a.shared)
			: []
	);
	const nameOf = (id: string) => reviewers.find((r) => r.id === id)?.name ?? id;
	const lit = (id: string) => !focus || id === focus.id || partners.some((p) => p.id === id);
	const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
</script>

<div class="map">
	<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="How the reviewers' kept findings overlap">
		{#each layout as n (n.id)}
			<circle class="kept" class:dim={!lit(n.id)} class:on={pointed === n.id} cx={n.cx} cy={n.cy} r={n.pr} />
		{/each}
		{#if focus && focus.ring > focus.pr}
			<circle class="ring" cx={focus.cx} cy={focus.cy} r={focus.ring} />
		{/if}
		<!-- Circles big enough to hold their name show it; the rest say on pointing. -->
		{#each layout.filter((n) => n.pr >= 34) as n (n.id)}
			<g class="label" class:dim={!lit(n.id)}>
				<text x={n.cx} y={n.cy - 2} text-anchor="middle" class="name">{n.name}</text>
				<text x={n.cx} y={n.cy + 14} text-anchor="middle" class="alone">{share(n.alone, n.kept)}% only {n.name}</text>
			</g>
		{/each}
		{#if focus && focus.pr < 34}
			<text x={focus.cx} y={focus.cy - focus.pr - 8} text-anchor="middle" class="name lone">{focus.name}</text>
		{/if}
		{#each layout as n (n.id)}
			<circle
				class="hit"
				role="presentation"
				cx={n.cx}
				cy={n.cy}
				r={Math.max(n.pr, 12)}
				onpointerenter={() => (pointed = n.id)}
				onpointerleave={() => (pointed = null)}
			/>
		{/each}
	</svg>
	<p class="card" class:shown={!!focus}>
		{#if focus}
			<strong>{focus.name}</strong>: {focus.kept} kept ({share(focus.alone, focus.kept)}% only {focus.name}) · {focus.decided - focus.kept} skipped
			{#if partners.length}· shares {partners.map((p) => `${p.shared} with ${nameOf(p.id)}`).join(', ')}{/if}
			· across {focus.rounds} {focus.rounds === 1 ? 'round' : 'rounds'}
		{:else}
			Circles are kept findings, overlapping where reviewers raised the same point. Point at one for more.
		{/if}
	</p>
</div>

<style>
	.map {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 16px 12px;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	svg {
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.kept {
		fill: rgba(127, 216, 155, 0.16);
		stroke: rgba(127, 216, 155, 0.7);
		stroke-width: 1.2;
		transition: opacity 120ms;
	}
	.kept.on {
		fill: rgba(127, 216, 155, 0.3);
		stroke: #7fd89b;
	}
	/* All it raised and you decided on, skipped too. */
	.ring {
		fill: none;
		stroke: var(--faint);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		pointer-events: none;
	}
	.dim {
		opacity: 0.25;
	}
	.label {
		pointer-events: none;
		transition: opacity 120ms;
	}
	.name,
	.alone {
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3px;
		stroke-linejoin: round;
	}
	.lone {
		pointer-events: none;
	}
	.name {
		fill: var(--text);
		font-size: 13px;
		font-weight: 500;
	}
	.alone {
		fill: var(--muted);
		font-size: 11.5px;
	}
	.hit {
		fill: transparent;
		cursor: default;
	}
	.card {
		margin: 0;
		min-height: 1.5em;
		color: var(--faint);
		font-size: 12.5px;
	}
	.card.shown {
		color: var(--muted);
	}
	.card strong {
		color: var(--text);
		font-weight: 500;
	}
</style>
