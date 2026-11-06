<script lang="ts" generics="V extends string">
	import type { Snippet } from 'svelte';
	import { onDismiss } from './dismiss';

	// A menu of choices under a trigger the caller draws: grouped options, the
	// current one ticked, each with an optional hint. It closes on a choice, a
	// click elsewhere, or Escape. `agent` gives it the panel's amber tones.
	// `filter`, its placeholder, puts a box at the top for a long list,
	// matching names, hints and headings; the arrow keys step through what's left and
	// Enter picks the one stepped to, or the first match.
	let {
		groups,
		value,
		onchoose,
		label,
		note,
		tone = 'plain',
		width = 220,
		placement = 'start',
		filter,
		trigger
	}: {
		groups: { heading?: string; items: { value: V; label: string; hint?: string }[] }[];
		value: V | undefined;
		onchoose: (value: V) => void;
		label: string;
		// A line above the options, such as what choosing here affects.
		note?: string;
		tone?: 'plain' | 'agent';
		// Its least width, padding included; `trigger` matches the trigger's.
		width?: number | 'trigger';
		// Lined up with the trigger's start, just outside it, or its end.
		placement?: 'start' | 'outside' | 'end';
		filter?: string;
		trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLSpanElement | null>(null);

	let query = $state('');
	let box = $state<HTMLInputElement | null>(null);
	// Focus moves into the filter on opening, and back to what had it when it
	// closes with the focus lost, gone with the menu or left nowhere; a click
	// elsewhere that took the focus keeps it. A browser that doesn't focus a
	// clicked button leaves the trigger to stand in.
	let opener: HTMLElement | null = null;
	$effect(() => {
		if (open) {
			const had = document.activeElement;
			opener ??= had instanceof HTMLElement && had !== document.body ? had : (root?.querySelector<HTMLElement>('button') ?? null);
			box?.focus();
		} else {
			query = '';
			active = -1;
			const now = document.activeElement;
			if (!now || now === document.body || root?.contains(now)) opener?.focus();
			opener = null;
		}
	});
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return groups;
		// A group whose heading matches from the start of a word, such as a
		// provider's name, keeps all of it; matching anywhere would let "de" keep "Claude Code".
		const headed = (heading?: string) => !!heading && ` ${heading.toLowerCase()}`.includes(` ${q}`);
		return groups
			.map((g) => (headed(g.heading) ? g : { ...g, items: g.items.filter((item) => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(q)) }))
			.filter((g) => g.items.length);
	});

	const matches = $derived(shown.flatMap((g) => g.items));
	let active = $state(-1);
	// An index into the options, so it starts over when they change beneath it.
	$effect(() => {
		void groups;
		active = -1;
	});
	let list = $state<HTMLDivElement | null>(null);
	// Nothing is lit once the pointer leaves, so a row it left isn't taken for a choice.
	$effect(() => {
		if (!list) return;
		const el = list;
		const leave = () => (active = -1);
		el.addEventListener('pointerleave', leave);
		return () => el.removeEventListener('pointerleave', leave);
	});
	function step(by: number) {
		if (!matches.length) return;
		// Opened upward, ↑ from the filter starts at the option nearest it, the last.
		if (active === -1 && by < 0 && up) active = matches.length;
		active = Math.max(0, Math.min(matches.length - 1, active + by));
		requestAnimationFrame(() => list?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }));
	}
	function onKey(e: KeyboardEvent) {
		// Keys confirming or choosing an input method's text are its own;
		// Safari can send the confirming Enter as 229, already done composing.
		if (e.isComposing || e.keyCode === 229) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			step(e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			// The first match only once something's typed, so a stray Enter
			// on opening changes nothing.
			const picked = matches[active] ?? (query.trim() ? matches[0] : undefined);
			if (!picked) return;
			choose(picked.value);
		}
	}

	// As tall as the window has room for, so its end can be scrolled to:
	// below the trigger, or above it when it doesn't fit below and there's
	// more room above. Which way is settled on opening, and again when the
	// caller's options change (a long list arriving late), but not as the
	// filter narrows them; scrolling and resizing change only how tall it is.
	let room = $state<number | null>(null);
	let up = $state(false);
	$effect(() => {
		void groups;
		if (!open || !root || !list) return;
		const el = root;
		const space = () => {
			const { top, bottom } = el.getBoundingClientRect();
			// Clear of the sticky top bar, as Floating keeps.
			return { below: window.innerHeight - bottom - 22, above: top - 76 };
		};
		const first = space();
		// Its own height, or enough of it to be worth scrolling.
		const flip = first.below < Math.min(list.scrollHeight, 240) && first.above > first.below;
		up = flip;
		const measure = () => {
			const { below, above } = space();
			room = Math.max(0, Math.min(window.innerHeight * 0.7, flip ? above : below));
		};
		measure();
		window.addEventListener('scroll', measure, { capture: true, passive: true });
		window.addEventListener('resize', measure);
		return () => {
			window.removeEventListener('scroll', measure, { capture: true });
			window.removeEventListener('resize', measure);
		};
	});

	function choose(item: V) {
		open = false;
		onchoose(item);
	}

	$effect(() => {
		if (!open) return;
		return onDismiss(
			() => (open = false),
			(target) => !!root?.contains(target)
		);
	});
</script>

<span class="root" bind:this={root}>
	{@render trigger({ open, toggle: () => (open = !open) })}
	{#if open}
		<div
			class="menu {tone} {placement}"
			class:up
			role="menu"
			aria-label={label}
			bind:this={list}
			style:min-width={width === 'trigger' ? '100%' : `${width}px`}
			style:max-height={room === null ? undefined : `${room}px`}
		>
			{#if note}<span class="note">{note}</span>{/if}
			{#if filter}
				<div class="filter">
					<input bind:this={box} bind:value={query} placeholder={filter} aria-label={filter} oninput={() => (active = -1)} onkeydown={onKey} />
				</div>
				{#if !shown.length}<span class="note">No matches</span>{/if}
			{/if}
			{#each shown as group, i (i)}
				{#if i > 0}<hr />{/if}
				{#if group.heading}<span class="group">{group.heading}</span>{/if}
				{#each group.items as item (item.value)}
					<button
						type="button"
						role="menuitemradio"
						class:active={matches[active]?.value === item.value}
						aria-checked={item.value === value}
						title={item.label}
						onpointermove={() => (active = matches.indexOf(item))}
						onclick={() => choose(item.value)}
					>
						<span class="label">{item.label}</span>
						{#if item.hint}<span class="hint">{item.hint}</span>{/if}
						{#if item.value === value}<span class="tick">✓</span>{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</span>

<style>
	.root {
		position: relative;
		display: inline-block;
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		max-height: 70vh;
		overflow-y: auto;
		padding: 6px;
		box-sizing: border-box;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			var(--shadow-menu);
		display: flex;
		flex-direction: column;
	}
	.up {
		top: auto;
		bottom: calc(100% + 6px);
	}
	.start {
		left: 0;
	}
	.outside {
		left: -8px;
	}
	.end {
		right: 0;
	}
	/* Stays at the top as a long list scrolls under it. */
	.filter {
		position: sticky;
		top: -6px;
		z-index: 1;
		flex-shrink: 0;
		margin: -6px -6px 0;
		padding: 8px 8px 6px;
		background: var(--surface-2);
	}
	/* Opening upward, it sits at the bottom by the trigger, so it stays put as
	   the list above it narrows. */
	.up .filter {
		order: 1;
		top: auto;
		bottom: -6px;
		margin: 0 -6px -6px;
		padding: 6px 8px 8px;
	}
	.filter input {
		box-sizing: border-box;
		width: 100%;
		height: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 13.5px;
		outline: none;
	}
	.filter input:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.note {
		padding: 6px 10px 2px;
		font-size: 12px;
		color: var(--faint);
	}
	.group {
		padding: 10px 10px 4px;
		font-size: 11px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	hr {
		align-self: stretch;
		margin: 6px 4px;
		border: 0;
		border-top: 1px solid var(--line-2);
	}
	/* A long list scrolls rather than squeezing its options. */
	button {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-auto-flow: column;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	/* Clear of the filter when stepped to: above, or below when it opens upward. */
	button {
		scroll-margin-top: 52px;
	}
	.up button {
		scroll-margin-top: 0;
		scroll-margin-bottom: 52px;
	}
	/* The row under the pointer is the one stepped to, so one row is lit. */
	button.active {
		background: var(--line-2);
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* On the right, so the options line up with their headings, and only on
	   the chosen one, so the rest keep the full width. */
	.tick {
		color: var(--done);
		font-size: 13px;
	}
	.hint {
		font-size: 12px;
		color: var(--faint);
	}
	.agent {
		background: #221e17;
		box-shadow:
			0 0 0 1px #3a3226,
			var(--shadow-menu);
	}
	.agent button.active {
		background: #2e281e;
	}
	.agent .filter {
		background: #221e17;
	}
	.agent .tick {
		color: var(--agent);
	}
</style>
