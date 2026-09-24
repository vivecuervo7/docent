<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { FileNote, LineRef, Mark, PrFile } from '$lib/api';
	import { highlightHunks, segments, type Token } from '$lib/diff/highlight';
	import { layout, parseFilePatch, wordEdits, type Row } from '$lib/diff/parse';
	import MarkPopover from './MarkPopover.svelte';

	let {
		file,
		hunkIndices = null,
		marks = [],
		note
	}: { file: PrFile; hunkIndices?: number[] | null; marks?: Mark[]; note?: FileNote } = $props();

	const hunks = $derived(
		parseFilePatch(file.patch ?? '').filter((h) => !hunkIndices || hunkIndices.includes(h.index))
	);
	const expanded = new SvelteSet<string>();
	const items = $derived(layout(hunks, expanded));
	const edits = $derived(wordEdits(hunks));

	let tokens = $state(new Map<string, Token[]>());
	$effect(() => {
		const current = hunks;
		let live = true;
		highlightHunks(current, file.filename).then((t) => live && (tokens = t));
		return () => (live = false);
	});

	// The rows on screen, in order: a mark's range and a selection are both
	// spans of these.
	const shown = $derived(
		items.flatMap((item) =>
			item.type === 'hunk' ? item.hunk.rows : item.expanded ? item.hunks.flatMap((h) => h.rows) : []
		)
	);
	const position = $derived(new Map(shown.map((r, i) => [r.key, i])));

	function rowAt(ref: LineRef): Row | undefined {
		return shown.find((r) =>
			ref.side === 'new' ? r.new === ref.line && r.kind !== 'del' : r.old === ref.line && r.kind !== 'add'
		);
	}

	const placed = $derived(
		marks.flatMap((mark) => {
			const start = rowAt(mark.start);
			if (!start) return [];
			const end = rowAt(mark.end) ?? start;
			const a = position.get(start.key)!;
			const b = position.get(end.key)!;
			return [{ mark, from: Math.min(a, b), to: Math.max(a, b), at: start.key }];
		})
	);
	const pinsAt = $derived(
		placed.reduce((by, p) => by.set(p.at, [...(by.get(p.at) ?? []), p]), new Map<string, typeof placed>())
	);

	let open = $state<string | null>(null);
	let hovered = $state<string | null>(null);

	// How a row is tinted by the marks covering it: the one being looked at
	// shows strongest.
	function tint(pos: number): string {
		const covering = placed.filter((p) => pos >= p.from && pos <= p.to);
		if (!covering.length) return '';
		const active = covering.find((p) => p.mark.id === open || p.mark.id === hovered);
		const kind = (active ?? covering[0]).mark.kind;
		return `tint-${kind}${active ? ' tint-active' : ''}`;
	}

	// Dragging down the line numbers selects lines to ask about.
	let selection = $state<{ anchor: number; head: number } | null>(null);
	let dragging = $state(false);
	const selFrom = $derived(selection ? Math.min(selection.anchor, selection.head) : -1);
	const selTo = $derived(selection ? Math.max(selection.anchor, selection.head) : -1);

	function startSelect(e: PointerEvent, pos: number) {
		if (e.button !== 0) return;
		e.preventDefault();
		open = null;
		dragging = true;
		selection = { anchor: pos, head: pos };
		window.addEventListener('pointerup', () => (dragging = false), { once: true });
	}

	// Named by the new file's lines, or the old file's when only removed
	// lines are selected.
	function describe(from: number, to: number): string {
		const rows = shown.slice(from, to + 1);
		const side = rows.some((r) => r.new !== undefined) ? 'new' : 'old';
		const nums = rows.map((r) => r[side]).filter((n) => n !== undefined);
		const first = nums[0];
		const last = nums[nums.length - 1];
		const label = first === last ? `line ${first}` : `lines ${first}–${last}`;
		return side === 'old' ? `${label} (removed)` : label;
	}

	function foldLines(item: { hunks: { rows: Row[] }[] }): string {
		const at = item.hunks.map((h) => h.rows.find((r) => r.kind !== 'context')).map((r) => r?.new ?? r?.old);
		return at.length > 4 ? `${at.slice(0, 4).join(', ')}, …` : at.join(', ');
	}

	let collapsed = $state(false);
</script>

{#snippet row(r: Row)}
	{@const pos = position.get(r.key)!}
	{@const pins = pinsAt.get(r.key)}
	<div
		class="row {r.kind} {tint(pos)}"
		class:selected={pos >= selFrom && pos <= selTo}
		role="presentation"
		onpointerenter={() => dragging && selection && (selection = { ...selection, head: pos })}
	>
		<span class="n" role="presentation" onpointerdown={(e) => startSelect(e, pos)}>{r.old ?? ''}</span>
		<span class="n" role="presentation" onpointerdown={(e) => startSelect(e, pos)}>{r.new ?? ''}</span>
		<span class="code"
			>{#each segments(r.text, tokens.get(r.key), edits.get(r.key)) as s, i (i)}<span
					class:edit={s.edit}
					style:color={s.color}>{s.text}</span
				>{/each}</span
		>
		<span class="gutter">
			{#each pins ?? [] as p (p.mark.id)}
				<button
					class="pin {p.mark.kind}"
					class:active={open === p.mark.id}
					aria-label="{p.mark.kind === 'finding' ? 'Finding' : 'Thread'} from {p.mark.who}"
					onclick={() => (open = open === p.mark.id ? null : p.mark.id)}
					onpointerenter={() => (hovered = p.mark.id)}
					onpointerleave={() => (hovered = null)}
				>
					{#if p.mark.kind === 'finding'}
						<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .6 11.4 6 6 11.4.6 6Z" /></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
					{/if}
				</button>
			{/each}
		</span>
		{#each pins ?? [] as p (p.mark.id)}
			{#if open === p.mark.id}
				<MarkPopover mark={p.mark} onclose={() => (open = null)} />
			{/if}
		{/each}
		{#if selection && !dragging && pos === selTo}
			<div class="sel-actions">
				<span class="faint">{describe(selFrom, selTo)}</span>
				<button class="btn primary">Ask about this</button>
				<button class="btn">Comment</button>
				<button class="icon" aria-label="Clear selection" onclick={() => (selection = null)}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
		{/if}
	</div>
{/snippet}

<section class="file">
	<header>
		<button class="icon" aria-label={collapsed ? 'Expand file' : 'Collapse file'} aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={collapsed ? '' : 'rotate(90deg)'}><path d="M9 6l6 6-6 6" /></svg>
		</button>
		<span class="path">{file.filename}</span>
		<span class="gist faint">{note ? `${note.kind === 'tests' ? 'Tests · ' : ''}${note.note.replace(/^- /, '').split('\n')[0]}` : ''}</span>
		<span class="stat"><span class="plus">+{file.additions}</span> <span class="minus">−{file.deletions}</span></span>
	</header>
	{#if !collapsed}
		<div class="diff">
			{#each items as item (item.type === 'hunk' ? `h${item.hunk.index}` : item.id)}
				{#if item.type === 'hunk'}
					<div class="hunk-header">{item.hunk.header}</div>
					{#each item.hunk.rows as r (r.key)}{@render row(r)}{/each}
				{:else}
					<button
						class="fold"
						aria-expanded={item.expanded}
						onclick={() => (item.expanded ? expanded.delete(item.id) : expanded.add(item.id))}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={item.expanded ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
						{item.expanded ? 'Showing' : 'The same change in'}
						{item.hunks.length} more places
						<span class="faint">· lines {foldLines(item)}</span>
					</button>
					{#if item.expanded}
						{#each item.hunks as hunk (hunk.index)}
							<div class="hunk-header">{hunk.header}</div>
							{#each hunk.rows as r (r.key)}{@render row(r)}{/each}
						{/each}
					{/if}
				{/if}
			{/each}
		</div>
	{/if}
</section>

<style>
	.file {
		border-radius: 12px;
		background: var(--code-bg);
		box-shadow: 0 0 0 1px var(--line);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 48px;
		padding: 0 14px 0 8px;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
	}
	.path {
		font-family: var(--mono);
		color: var(--text);
		white-space: nowrap;
	}
	.gist {
		flex-grow: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat {
		font-family: var(--mono);
		font-size: 12px;
	}
	.plus {
		color: var(--plus);
	}
	.minus {
		color: var(--minus);
	}
	.diff {
		padding-bottom: 6px;
	}
	.hunk-header {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		padding: 8px 16px 6px 112px;
	}
	.row {
		position: relative;
		display: grid;
		grid-template-columns: 48px 48px minmax(0, 1fr) 40px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 22px;
		tab-size: 4;
	}
	.row.add {
		background: var(--add-bg);
	}
	.row.del {
		background: var(--del-bg);
	}
	.row.tint-finding .code {
		background-image: linear-gradient(var(--agent-tint), var(--agent-tint));
	}
	.row.tint-note .code {
		background-image: linear-gradient(var(--you-tint), var(--you-tint));
	}
	.row.tint-active .code {
		box-shadow: inset 2px 0 0 var(--agent);
	}
	.row.tint-note.tint-active .code {
		box-shadow: inset 2px 0 0 var(--you);
	}
	.row.selected .n,
	.row.selected .code {
		background-color: var(--selection);
	}
	.n {
		color: var(--line-num);
		text-align: right;
		padding-right: 14px;
		user-select: none;
		cursor: row-resize;
	}
	.n:hover {
		color: var(--muted);
	}
	.code {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding-left: 8px;
		color: var(--code-text);
	}
	.del .edit {
		background: var(--del-edit);
		border-radius: 2px;
	}
	.add .edit {
		background: var(--add-edit);
		border-radius: 2px;
	}
	.gutter {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 2px;
		padding-top: 2px;
	}
	.pin {
		display: grid;
		place-items: center;
		width: 22px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 9px;
		cursor: pointer;
	}
	.pin.finding {
		background: var(--agent-chip);
		fill: var(--agent);
	}
	.pin.note {
		background: var(--you-chip);
		fill: var(--you);
	}
	.pin.active,
	.pin:hover {
		filter: brightness(1.3);
	}
	.fold {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 36px;
		padding: 0 16px 0 104px;
		border: 0;
		border-top: 1px dashed var(--line-2);
		border-bottom: 1px dashed var(--line-2);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
		background: var(--surface);
	}
	.sel-actions {
		position: absolute;
		left: 104px;
		top: calc(100% + 6px);
		z-index: 15;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 14px;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 20px 50px -20px rgba(0, 0, 0, 0.8);
		font-family: var(--sans);
		font-size: 13px;
	}
</style>
