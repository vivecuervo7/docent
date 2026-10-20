<script lang="ts">
	import { dayKey } from './summary';

	// The last year a day to a square, as GitHub shows contributions: weeks
	// across, Sunday to Saturday down, darker for days nothing was done.
	let { days }: { days: Map<string, number> } = $props();

	const WEEKS = 53;
	const grid = $derived.by(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const start = new Date(today);
		start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);
		const counts = [...days.values()].sort((a, b) => a - b);
		// Shades by where a day falls among the busy ones.
		const at = (q: number) => counts[Math.min(counts.length - 1, Math.floor(q * counts.length))] ?? 1;
		const steps = [at(0.25), at(0.5), at(0.75)];
		const level = (n: number) => (n === 0 ? 0 : 1 + steps.filter((s) => n > s).length);
		const weeks: { date: Date; count: number; level: number; future: boolean }[][] = [];
		const months: { week: number; label: string }[] = [];
		for (let w = 0; w < WEEKS; w++) {
			const week = [];
			for (let d = 0; d < 7; d++) {
				const date = new Date(start);
				date.setDate(start.getDate() + w * 7 + d);
				const count = days.get(dayKey(date.getTime())) ?? 0;
				week.push({ date, count, level: level(count), future: date > today });
				if (date.getDate() === 1 && w < WEEKS - 1) months.push({ week: w, label: date.toLocaleString(undefined, { month: 'short' }) });
			}
			weeks.push(week);
		}
		return { weeks, months };
	});
	const label = (c: { date: Date; count: number }) =>
		`${c.count ? `${c.count} ${c.count === 1 ? 'thing' : 'things'} done` : 'Nothing done'} on ${c.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
</script>

<div class="map">
	<div class="months" aria-hidden="true">
		{#each grid.months as m (m.week)}<span style:grid-column="{m.week + 2} / span 4">{m.label}</span>{/each}
	</div>
	<div class="body">
		<div class="weekdays" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
		<div class="weeks">
			{#each grid.weeks as week, w (w)}
				<div class="week">
					{#each week as c, d (d)}
						{#if c.future}<span class="day future"></span>{:else}<span class="day l{c.level}" title={label(c)}></span>{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>
	<div class="legend faint">
		Less
		{#each [0, 1, 2, 3, 4] as l (l)}<span class="day l{l}"></span>{/each}
		More
	</div>
</div>

<style>
	.map {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px 18px 14px;
		border-radius: 14px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		overflow-x: auto;
	}
	.months {
		display: grid;
		grid-template-columns: 30px repeat(53, 13px);
		font-size: 11.5px;
		color: var(--muted);
	}
	.body {
		display: flex;
	}
	.weekdays {
		display: grid;
		grid-template-rows: repeat(7, 13px);
		width: 30px;
		font-size: 11px;
		line-height: 13px;
		color: var(--muted);
	}
	.weeks {
		display: flex;
	}
	.week {
		display: grid;
		grid-template-rows: repeat(7, 13px);
		width: 13px;
	}
	.day {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.day.future {
		visibility: hidden;
	}
	.l0 {
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.l1 {
		background: #1f3a29;
	}
	.l2 {
		background: #2f5f3f;
	}
	.l3 {
		background: #4f9466;
	}
	.l4 {
		background: #7fd89b;
	}
	.legend {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		font-size: 12px;
	}
	.legend .day {
		display: inline-block;
	}
</style>
