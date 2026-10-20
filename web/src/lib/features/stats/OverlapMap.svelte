<script lang="ts">
	import type { OverlapPair, OverlapReviewer } from './summary';

	// Reviewers as circles sized by the findings of theirs you kept, set so
	// each pair overlaps by about how many of the smaller one's kept findings
	// the other corroborated: a circle mostly inside another finds little the
	// other doesn't; one off on its own finds its own. Only reviewers that ran
	// together are drawn together; pointing at one rings what it wanted
	// posted, kicked back too, and shows who corroborates it.
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
	// What two circles' distance should be for them to overlap by the given
	// area: exactly, for a partial overlap; at most, for one wholly inside the
	// other; at least, for none.
	function apart(r1: number, r2: number, area: number): { d: number; kind: 'exact' | 'within' | 'clear' } {
		if (area <= 0) return { d: (r1 + r2) * 1.08, kind: 'clear' };
		if (area >= Math.PI * Math.min(r1, r2) ** 2 * 0.999) return { d: Math.abs(r1 - r2) * 0.85, kind: 'within' };
		let lo = Math.abs(r1 - r2);
		let hi = r1 + r2;
		for (let i = 0; i < 40; i++) {
			const mid = (lo + hi) / 2;
			if (lens(r1, r2, mid) > area) lo = mid;
			else hi = mid;
		}
		return { d: (lo + hi) / 2, kind: 'exact' };
	}

	// Placed by nudging each pair towards its distance, many times over;
	// reviewers that never ran together, or share nothing, only keep clear.
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
				// From the smaller one's side: how much of it the other corroborates.
				const smaller = n.kept <= m.kept ? n.id : m.id;
				const shared = !p ? 0 : p.a === smaller ? p.aShared : p.bShared;
				const { d, kind } = apart(n.r, m.r, together ? shared : 0);
				return { n, m, target: d, kind, weight: together ? 1 : 0.3 };
			})
		);
		for (let step = 0; step < 800; step++) {
			const rate = 0.5 * (1 - step / 800) + 0.02;
			for (const { n, m, target, kind, weight } of links) {
				const dx = m.x - n.x;
				const dy = m.y - n.y;
				const dist = Math.hypot(dx, dy) || 0.001;
				// Inside is inside, and clear is clear: only an exact overlap is
				// held to its distance.
				if ((kind === 'clear' && dist >= target) || (kind === 'within' && dist <= target)) continue;
				const move = ((dist - target) / dist) * weight * rate * 0.5;
				n.x += dx * move;
				n.y += dy * move;
				m.x -= dx * move;
				m.y -= dy * move;
			}
		}
		// The hovered ring, a gauge for one reviewer at a time, widens by its
		// radius in step with what you kicked back, so a third rejected reads
		// as a ring a third wider.
		const gauge = (n: { r: number; kept: number; kickedBack: number }) => (n.r * (n.kept + n.kickedBack)) / n.kept;
		const outer = (n: (typeof nodes)[number]) => gauge(n);
		const minX = Math.min(...nodes.map((n) => n.x - outer(n)));
		const maxX = Math.max(...nodes.map((n) => n.x + outer(n)));
		const minY = Math.min(...nodes.map((n) => n.y - outer(n)));
		const maxY = Math.max(...nodes.map((n) => n.y + outer(n)));
		const scale = Math.min((WIDTH - PAD * 2) / (maxX - minX || 1), (HEIGHT - PAD * 2) / (maxY - minY || 1));
		const ox = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
		const oy = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;
		return nodes.map((n) => ({ ...n, cx: n.x * scale + ox, cy: n.y * scale + oy, pr: n.r * scale, ring: gauge(n) * scale }));
	});

	let pointed = $state<string | null>(null);
	const focus = $derived(layout.find((n) => n.id === pointed));
	const partners = $derived(
		focus
			? pairs
					.filter((p) => (p.a === focus.id || p.b === focus.id) && p.aShared + p.bShared > 0)
					.map((p) => ({ id: p.a === focus.id ? p.b : p.a }))
			: []
	);
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
				<text x={n.cx} y={n.cy + 4} text-anchor="middle" class="name">{n.name}</text>
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
	<!-- What pointing at a reviewer tells, in the corner. -->
	{#if focus}
		<dl class="legend">
			<dt class="who">{focus.name}</dt>
			<dd></dd>
			<dt>Kept</dt>
			<dd>{focus.kept}</dd>
			<dt class="sub">Unique</dt>
			<dd>{focus.alone} <span class="faint">({share(focus.alone, focus.kept)}%)</span></dd>
			<dt class="sub">Corroborated</dt>
			<dd>{focus.kept - focus.alone} <span class="faint">({share(focus.kept - focus.alone, focus.kept)}%)</span></dd>
			<dt>Kicked back</dt>
			<dd>{focus.kickedBack}</dd>
			{#if focus.kickedBack}
				<dt class="sub">Unique</dt>
				<dd>{focus.aloneKicked} <span class="faint">({share(focus.aloneKicked, focus.kickedBack)}%)</span></dd>
				<dt class="sub">Corroborated</dt>
				<dd>
					{focus.kickedBack - focus.aloneKicked} <span class="faint">({share(focus.kickedBack - focus.aloneKicked, focus.kickedBack)}%)</span>
				</dd>
			{/if}
		</dl>
	{/if}
	<p class="hint faint">Kept findings, overlapping where reviewers raised the same point. Point at one for its figures.</p>
</div>

<style>
	.map {
		position: relative;
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
	/* What it wanted posted: kept, and what you kicked back. */
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
	.lone {
		pointer-events: none;
	}
	.name {
		fill: var(--text);
		font-size: 13px;
		font-weight: 500;
	}
	.hit {
		fill: transparent;
		cursor: default;
	}
	.legend {
		position: absolute;
		top: 14px;
		left: 16px;
		display: grid;
		grid-template-columns: auto auto;
		gap: 4px 18px;
		margin: 0;
		padding: 10px 12px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--surface) 88%, transparent);
		box-shadow: inset 0 0 0 1px var(--line-2);
		font-size: 12.5px;
		pointer-events: none;
	}
	.legend dt {
		color: var(--muted);
	}
	.legend dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	/* Of the figure above: what of it only this reviewer raised, and what
	   another did too. */
	.legend .sub {
		padding-left: 12px;
		color: var(--faint);
	}
	.legend .who {
		color: var(--text);
		font-weight: 500;
	}
	.hint {
		margin: 0;
		font-size: 12.5px;
	}
</style>
