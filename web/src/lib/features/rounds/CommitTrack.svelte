<script lang="ts">
	import type { Snippet } from 'svelte';

	// A PR's commits along a line, oldest first: a pip for each, stretches of
	// the line filled for the commits a round covers, and each day labelled
	// at its first commit. What sits over it - the range picker's knobs - is
	// its children, laid over the line.

	type Tone = 'in' | 'other' | 'new' | 'out';
	let {
		dates,
		fills = [],
		tones,
		titles,
		onpip,
		knob = 16,
		children
	}: {
		// Each commit's date, in order.
		dates: string[];
		// Stretches of the line to fill, by commit position.
		fills?: { from: number; to: number; tone: 'in' | 'other' }[];
		tones: Tone[];
		titles?: string[];
		// Makes a pip a button.
		onpip?: (i: number) => void;
		// The width the knobs over it take, so the pips line up under them.
		knob?: number;
		children?: Snippet;
	} = $props();

	const last = $derived(dates.length - 1);
	const at = (i: number) => `calc(var(--knob) / 2 + (100% - var(--knob)) * ${last ? i / last : 0})`;

	const dayOf = (iso: string) => new Date(iso).toDateString();
	function dayLabel(iso: string): string {
		const day = new Date(iso);
		const today = new Date();
		const yesterday = new Date(today.getTime() - 86_400_000);
		if (day.toDateString() === today.toDateString()) return 'Today';
		if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	}
	// Where two labels would run into each other the later day keeps its
	// label: recent work is what's usually picked out.
	const LABEL_ROOM = 52;
	let width = $state(0);
	const days = $derived.by(() => {
		const out: { i: number; label: string }[] = [];
		const px = (i: number) => (last ? (i / last) * width : 0);
		dates.forEach((d, i) => {
			if (i > 0 && dayOf(dates[i - 1]) === dayOf(d)) return;
			const before = out.at(-1);
			if (before && px(i) - px(before.i) < LABEL_ROOM) out.pop();
			out.push({ i, label: dayLabel(d) });
		});
		return out;
	});
</script>

<div class="track" style:--knob="{knob}px">
	<div class="line"></div>
	{#each fills as f, n (n)}
		<div class="fill {f.tone}" style:left={at(f.from)} style:right="calc(100% - {at(f.to)})"></div>
	{/each}
	{#each tones as tone, i (i)}
		{#if onpip}
			<button class="pip {tone}" style:left={at(i)} title={titles?.[i]} aria-label={titles?.[i]} onclick={() => onpip(i)}></button>
		{:else}
			<span class="pip {tone}" style:left={at(i)} title={titles?.[i]}></span>
		{/if}
	{/each}
	{@render children?.()}
</div>
<div class="days" style:--knob="{knob}px" bind:clientWidth={width}>
	{#each days as d (d.i)}<span style:left={at(d.i)}>{d.label}</span>{/each}
</div>

<style>
	.track {
		position: relative;
		height: 24px;
	}
	.line,
	.fill {
		position: absolute;
		top: 11px;
		height: 2px;
		border-radius: 1px;
	}
	.line {
		left: 0;
		right: 0;
		background: var(--line-2);
	}
	.fill.in {
		background: var(--you);
	}
	.fill.other {
		background: var(--faint);
		opacity: 0.6;
	}
	.pip {
		position: absolute;
		top: 9px;
		width: 6px;
		height: 6px;
		margin-left: -3px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--line-2);
	}
	button.pip {
		cursor: pointer;
	}
	/* A bigger target than it looks. */
	button.pip::after {
		content: '';
		position: absolute;
		inset: -6px -1px;
	}
	button.pip:hover {
		transform: scale(1.5);
	}
	.pip.in {
		background: var(--you);
	}
	.pip.other {
		background: var(--faint);
	}
	.pip.new {
		background: var(--bg);
		box-shadow: inset 0 0 0 1.5px var(--you);
	}
	.days {
		position: relative;
		height: 18px;
		font-size: 12px;
		color: var(--faint);
	}
	.days span {
		position: absolute;
		transform: translateX(-50%);
		white-space: nowrap;
	}
	.days span:first-child {
		transform: none;
		margin-left: calc(var(--knob) / -2);
	}
</style>
