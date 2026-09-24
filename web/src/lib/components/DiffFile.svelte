<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Mark } from '$lib/api';
	import type { FileNote, LineRef, PrFile, PrRef } from '$lib/types';
	import { highlightHunks, segments, type Token } from '$lib/diff/highlight';
	import {
		EXPAND_STEP,
		expandHunk,
		expansionFor,
		fileLines,
		gapAbove,
		gapBelow,
		hideWhitespace,
		layout,
		wordEdits,
		type Expansion,
		type Hunk,
		type Row
	} from '$lib/diff/parse';
	import InlineText from './InlineText.svelte';
	import { useSession } from '$lib/session.svelte';
	import { isUnread } from '$lib/types';
	import MarkPopover from './MarkPopover.svelte';
	import ThreadPanel from './ThreadPanel.svelte';
	import NoteText from './NoteText.svelte';
	import StateMark from './StateMark.svelte';

	let {
		file,
		allHunks,
		hunkIndices = null,
		marks = [],
		note,
		prRef,
		whitespace = false,
		reviewed = false,
		onToggleReviewed,
		fold = null,
		onopenchange,
		foldTests = true
	}: {
		file: PrFile;
		// Every hunk in the file, shown or not: expansion stops at its neighbours.
		allHunks: Hunk[];
		hunkIndices?: number[] | null;
		marks?: Mark[];
		note?: FileNote;
		prRef: PrRef;
		// Show whitespace-only changes as changes.
		whitespace?: boolean;
		reviewed?: boolean;
		onToggleReviewed?: () => void;
		// The page's last "expand all" or "collapse all", if any.
		fold?: { open: boolean; at: number } | null;
		// Told whenever the file opens or closes, and that it's closed when it goes.
		onopenchange?: (open: boolean) => void;
		// Fold test code between the scenario lines the note marks.
		foldTests?: boolean;
	} = $props();

	const shownIndices = $derived(new Set(hunkIndices ?? allHunks.map((h) => h.index)));

	// Unchanged lines shown around each hunk. They come from the file as it
	// was, fetched the first time any are asked for.
	let requested = $state<Record<number, Expansion>>({});
	let oldLines = $state<string[] | null>(null);
	let loadingOld: Promise<void> | null = null;
	const canExpand = $derived(file.status !== 'added');

	// Lines threads were begun on outside their hunk's diff, which have to
	// be shown again.
	const needed = $derived.by(() => {
		const out: Record<number, Expansion> = {};
		for (const m of marks) {
			const h = m.note && allHunks[m.note.hunk];
			if (!h) continue;
			const e = expansionFor(h, m.start, m.end);
			const prev = out[h.index] ?? { up: 0, down: 0 };
			out[h.index] = { up: Math.max(prev.up, e.up), down: Math.max(prev.down, e.down) };
		}
		return out;
	});
	$effect(() => {
		if (canExpand && Object.values(needed).some((e) => e.up || e.down)) loadOld();
	});

	const expansion = $derived.by(() => {
		const out: Expansion[] = [];
		for (const h of allHunks) {
			const i = h.index;
			const asked = requested[i] ?? { up: 0, down: 0 };
			const need = needed[i] ?? { up: 0, down: 0 };
			const want = { up: Math.max(asked.up, need.up), down: Math.max(asked.down, need.down) };
			if (!oldLines) {
				out[i] = { up: 0, down: 0 };
				continue;
			}
			const up = Math.min(want.up, gapAbove(allHunks, i) - (out[i - 1]?.down ?? 0));
			const down = Math.min(want.down, gapBelow(allHunks, i, oldLines.length));
			out[i] = { up: Math.max(0, up), down: Math.max(0, down) };
		}
		return out;
	});

	// Lines still hidden above and below a hunk; below the last one is unknown
	// until the old file is fetched.
	function hiddenAbove(i: number): number {
		return canExpand ? gapAbove(allHunks, i) - expansion[i].up - (expansion[i - 1]?.down ?? 0) : 0;
	}
	function hiddenBelow(i: number): number {
		if (!canExpand) return 0;
		if (!oldLines) return i < allHunks.length - 1 ? gapBelow(allHunks, i, 0) : 1;
		return gapBelow(allHunks, i, oldLines.length) - expansion[i].down - (expansion[i + 1]?.up ?? 0);
	}

	function loadOld(): Promise<void> {
		loadingOld ??= fetch(
				`/api/pr/${prRef.owner}/${prRef.repo}/${prRef.number}/old-content?path=${encodeURIComponent(file.previous_filename ?? file.filename)}`
			)
				.then((res) => (res.ok ? res.json() : { content: null }))
				.then((data: { content: string | null }) => {
					oldLines = fileLines(data.content ?? '');
				})
				.catch(() => {
					loadingOld = null;
				});
		return loadingOld ?? Promise.resolve();
	}

	async function expand(i: number, direction: 'up' | 'down') {
		if (!oldLines) await loadOld();
		const now = expansion[i] ?? { up: 0, down: 0 };
		requested = { ...requested, [i]: { ...now, [direction]: now[direction] + EXPAND_STEP } };
	}

	const hunks = $derived(
		allHunks
			.filter((h) => shownIndices.has(h.index))
			.map((h) => (oldLines ? expandHunk(h, expansion[h.index], oldLines) : h))
			.map((h) => (whitespace ? h : hideWhitespace(h)))
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

	// Quiet, not hidden: code only worth skimming folds, and its row says
	// what's inside.
	// - Test files read as their scenarios: the code between the lines that
	//   name a test folds, but only when it's wholly new or unchanged - an
	//   edit or a deletion is what needs reading, so it stays open.
	// - Imports and test setup fold whatever changed, with +/- on the row.
	type Piece = { type: 'row'; row: Row } | { type: 'fold'; id: string; rows: Row[]; label?: string };
	const openFolds = new SvelteSet<string>();
	const scenarioLines = $derived(new Set(foldTests && note?.kind === 'tests' ? (note.scenarioLines ?? []) : []));
	const quietRanges = $derived(foldTests ? (note?.quietRanges ?? []) : []);
	const MIN_FOLD = 3;

	function pieces(hunk: Hunk): Piece[] {
		const { rows } = hunk;
		const onNew = (r: Row, from: number, to: number) => r.kind !== 'del' && r.new !== undefined && r.new >= from && r.new <= to;
		const ranges: { from: number; to: number; label?: string }[] = [];
		for (const q of quietRanges) {
			const from = rows.findIndex((r) => onNew(r, q.startLine, q.endLine));
			const to = rows.findLastIndex((r) => onNew(r, q.startLine, q.endLine));
			const body = rows.slice(from, to + 1);
			// Setup, like test bodies, only folds when nothing in it was edited.
			const uniform = body.every((r) => r.kind === 'add') || body.every((r) => r.kind === 'context');
			if (from >= 0 && to - from + 1 >= MIN_FOLD && (q.kind === 'imports' || uniform)) ranges.push({ from, to, label: q.kind });
		}
		const titles = rows.flatMap((r, i) => (r.kind !== 'del' && r.new !== undefined && scenarioLines.has(r.new) ? [i] : []));
		titles.forEach((t, n) => {
			const end = n + 1 < titles.length ? titles[n + 1] : rows.length;
			const body = rows.slice(t + 1, end);
			const uniform = body.every((r) => r.kind === 'add') || body.every((r) => r.kind === 'context');
			if (body.length >= MIN_FOLD && uniform) ranges.push({ from: t + 1, to: end - 1 });
		});
		ranges.sort((a, b) => a.from - b.from);
		const out: Piece[] = [];
		let i = 0;
		for (const range of ranges) {
			if (range.from < i) continue;
			for (; i < range.from; i++) out.push({ type: 'row', row: rows[i] });
			out.push({ type: 'fold', id: `${hunk.index}:${range.from}`, rows: rows.slice(range.from, range.to + 1), label: range.label });
			i = range.to + 1;
		}
		for (; i < rows.length; i++) out.push({ type: 'row', row: rows[i] });
		return out;
	}

	const piecesOf = $derived(new Map(hunks.map((h) => [h.index, pieces(h)])));
	const visible = (h: Hunk) =>
		(piecesOf.get(h.index) ?? []).flatMap((p) => (p.type === 'row' ? [p.row] : openFolds.has(p.id) ? p.rows : []));

	// The rows on screen, in order: a mark's range and a selection are both
	// spans of these.
	const shown = $derived(
		items.flatMap((item) => (item.type === 'hunk' ? [item.hunk] : item.expanded ? item.hunks : []).flatMap(visible))
	);

	// Marks on lines a fold is hiding, shown on the fold instead.
	const matchesRow = (r: Row, ref: LineRef) =>
		ref.side === 'new' ? r.new === ref.line && r.kind !== 'del' : r.old === ref.line && r.kind !== 'add';
	const hiddenMarks = (rows: Row[]) => marks.filter((m) => rows.some((r) => matchesRow(r, m.start)));
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

	const session = useSession();
	let draft = $state('');

	// A thread on the selected lines, kept with the hunk the selection starts
	// in and the lines as they read now.
	function startThread() {
		const text = draft.trim();
		if (!text || !selection) return;
		const rows = shown.slice(selFrom, selTo + 1);
		const ref = (r: Row): LineRef => (r.kind === 'del' ? { side: 'old', line: r.old! } : { side: 'new', line: r.new! });
		const id = session.createNote(
			{
				path: file.filename,
				hunk: parseInt(rows[0].key, 10),
				start: ref(rows[0]),
				end: ref(rows[rows.length - 1]),
				code: rows.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`).join('\n')
			},
			text
		);
		selection = null;
		draft = '';
		open = id;
	}

	// A click anywhere but the open thread, finding or composer closes it.
	$effect(() => {
		if (!open && !(selection && !dragging)) return;
		const close = (e: PointerEvent) => {
			const el = e.target as Element;
			if (el.closest('.popover, .composer, .pin, .n')) return;
			open = null;
			selection = null;
		};
		window.addEventListener('pointerdown', close);
		return () => window.removeEventListener('pointerdown', close);
	});

	// The composer takes focus as it opens, so typing goes to it and never to
	// the page's shortcuts. Autofocus alone loses to whatever held focus.
	function focusNow(node: HTMLElement) {
		requestAnimationFrame(() => node.focus());
	}

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

	// Reviewed files start closed, and close when marked reviewed.
	let collapsed = $state(untrack(() => reviewed));

	$effect(() => {
		if (fold) collapsed = !fold.open;
	});

	$effect(() => {
		onopenchange?.(!collapsed);
		return () => onopenchange?.(false);
	});

	function toggleReviewed() {
		if (!reviewed) collapsed = true;
		onToggleReviewed?.();
	}
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
						{#if p.mark.note && isUnread(p.mark.note)}<span class="unread" aria-label="New reply"></span>{/if}
					{/if}
				</button>
			{/each}
		</span>
		{#each pins ?? [] as p (p.mark.id)}
			{#if open === p.mark.id}
				{#if p.mark.note}
					<ThreadPanel note={p.mark.note} onclose={() => (open = null)} />
				{:else}
					<MarkPopover mark={p.mark} onclose={() => (open = null)} />
				{/if}
			{/if}
		{/each}
		{#if selection && !dragging && pos === selTo}
			<div class="composer" role="dialog" aria-label="Ask or comment on {describe(selFrom, selTo)}">
				<div class="composer-head">
					<span class="faint">{describe(selFrom, selTo)}</span>
					<button class="icon" aria-label="Cancel" onclick={() => (selection = null)}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
					</button>
				</div>
				<textarea
					bind:value={draft}
					rows="2"
					use:focusNow
					placeholder="Ask a question, or jot a comment for the author…"
					aria-label="Ask or comment"
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							startThread();
						} else if (e.key === 'Escape') selection = null;
					}}
				></textarea>
				<div class="composer-foot">
					<span class="faint">Enter to send · Shift+Enter for a new line</span>
					<button class="btn primary" disabled={!draft.trim()} onclick={startThread}>Send</button>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet foldRow(id: string, rows: Row[], label?: string)}
	{@const isOpen = openFolds.has(id)}
	{@const hidden = isOpen ? [] : hiddenMarks(rows)}
	{@const added = rows.filter((r) => r.kind === 'add').length}
	{@const removed = rows.filter((r) => r.kind === 'del').length}
	<button class="fold-row" aria-expanded={isOpen} title={isOpen ? 'Fold this code' : 'Show this code'} onclick={() => (isOpen ? openFolds.delete(id) : openFolds.add(id))}>
		<span class="fold-tab" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" style:transform={isOpen ? 'rotate(90deg)' : ''}><path d="M7 4l12 8-12 8z" fill="currentColor" /></svg></span>
		<span class="fold-kind">{label ?? '…'}</span>
		<!-- The counts say what's hidden, so they go once it's open. -->
		{#if !isOpen}
			{#if added || removed}
				<span class="fold-changes">{#if added}<span class="plus">+{added}</span>{/if} {#if removed}<span class="minus">−{removed}</span>{/if}</span>
			{:else}
				<span class="fold-changes">{rows.length} unchanged lines</span>
			{/if}
		{/if}
		{#if hidden.length}
			<span class="fold-pins">
				{#each hidden as m (m.id)}
					<span class="fold-pin {m.kind}" title="{m.kind === 'finding' ? 'A finding' : 'A thread'} is inside">
						{#if m.kind === 'finding'}<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .6 11.4 6 6 11.4.6 6Z" /></svg>{:else}<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>{/if}
					</span>
				{/each}
			</span>
		{/if}
	</button>
{/snippet}

{#snippet hunkBlock(hunk: Hunk)}
	<div class="hunk-header">
		<span class="hunk-text">{hunk.header}</span>
		{#if hiddenAbove(hunk.index) > 0}
			<button class="expand" onclick={() => expand(hunk.index, 'up')}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
				{Math.min(EXPAND_STEP, hiddenAbove(hunk.index))} more lines
			</button>
		{/if}
	</div>
	{#each piecesOf.get(hunk.index) ?? [] as piece (piece.type === 'row' ? piece.row.key : piece.id)}
		{#if piece.type === 'row'}
			{@render row(piece.row)}
		{:else}
			{@render foldRow(piece.id, piece.rows, piece.label)}
			{#if openFolds.has(piece.id)}{#each piece.rows as r (r.key)}{@render row(r)}{/each}{/if}
		{/if}
	{/each}
	{#if !shownIndices.has(hunk.index + 1) && hiddenBelow(hunk.index) > 0}
		<div class="hunk-footer">
			<button class="expand" onclick={() => expand(hunk.index, 'down')}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
				{oldLines ? `${Math.min(EXPAND_STEP, hiddenBelow(hunk.index))} more lines` : 'More lines'}
			</button>
		</div>
	{/if}
{/snippet}

<section class="file">
	<header>
		<button class="toggle" aria-expanded={!collapsed} title={file.filename} onclick={() => (collapsed = !collapsed)}>
			<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={collapsed ? '' : 'rotate(90deg)'}><path d="M9 6l6 6-6 6" /></svg>
			<span class="path">{file.filename.split('/').pop()}</span>
			<span class="gist faint">{#if note?.note && collapsed}<InlineText text={`${note.kind === 'tests' ? 'Tests · ' : ''}${note.note.replace(/^- /, '').split('\n')[0]}`} />{/if}</span>
			<span class="stat"><span class="plus">+{file.additions}</span> <span class="minus">−{file.deletions}</span></span>
		</button>
		{#if onToggleReviewed}
			<button
				class="review"
				class:done={reviewed}
				aria-pressed={reviewed}
				onclick={toggleReviewed}
			>
				<StateMark state={reviewed ? 'done' : 'todo'} size={15} />
				{reviewed ? 'Reviewed' : 'Mark reviewed'}
			</button>
		{/if}
	</header>
	{#if !collapsed && note?.note}
		<div class="note">
			<NoteText text={note.note} />
			{#if note.quality}<p><InlineText text={note.quality} /></p>{/if}
		</div>
	{/if}
	{#if !collapsed}
		<div class="diff">
			{#each items as item (item.type === 'hunk' ? `h${item.hunk.index}` : item.id)}
				{#if item.type === 'hunk'}
					{@render hunkBlock(item.hunk)}
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
						{#if !item.expanded && hiddenMarks(item.hunks.flatMap((h) => h.rows)).length}
							<span class="fold-pins">
								{#each hiddenMarks(item.hunks.flatMap((h) => h.rows)) as m (m.id)}
									<span class="fold-pin {m.kind}" title="{m.kind === 'finding' ? 'A finding' : 'A thread'} is inside">
										{#if m.kind === 'finding'}<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .6 11.4 6 6 11.4.6 6Z" /></svg>{:else}<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>{/if}
									</span>
								{/each}
							</span>
						{/if}
					</button>
					{#if item.expanded}
						{#each item.hunks as hunk (hunk.index)}{@render hunkBlock(hunk)}{/each}
					{/if}
				{/if}
			{/each}
		</div>
	{/if}
</section>

<style>
	.file {
		border-bottom: 1px solid var(--line);
	}
	header {
		display: flex;
		align-items: center;
		height: 52px;
	}
	.toggle {
		flex-grow: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 4px 0 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 13.5px;
		text-align: left;
		cursor: pointer;
	}
	.chevron {
		flex-shrink: 0;
		color: var(--faint);
	}
	.toggle:hover .chevron,
	.toggle:hover .path {
		color: #fff;
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
		white-space: nowrap;
	}
	.plus {
		color: var(--plus-dull);
	}
	.minus {
		color: var(--minus-dull);
	}
	.note {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 860px;
		padding: 2px 0 16px 30px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted);
	}
	.note p {
		margin: 0;
	}
	.fold-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 28px;
		padding: 0 16px;
		border: 0;
		background: var(--hunk-bg);
		color: var(--muted);
		font-family: var(--sans);
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
	}
	.fold-row:hover {
		color: var(--text);
		background: #202127;
	}
	.fold-kind {
		font-family: var(--mono);
		font-size: 12px;
	}
	.fold-changes {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 12px;
	}
	/* Hangs off the block's left edge, so a fold is seen even at a glance. */
	.fold-tab {
		position: absolute;
		left: -20px;
		top: 5px;
		display: grid;
		place-items: center;
		width: 16px;
		height: 18px;
		color: var(--muted);
	}
	.fold-pin {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 22px;
		height: 18px;
		margin-top: 1px;
		border-radius: 9px;
	}
	.fold-pin.finding {
		background: var(--agent-chip);
		fill: var(--agent);
	}
	.fold-pin.note {
		background: var(--you-chip);
		fill: var(--you);
	}
	.diff {
		margin-bottom: 18px;
		padding-bottom: 6px;
		border-radius: 12px;
		background: var(--code-bg);
	}
	.hunk-header,
	.hunk-footer {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 30px;
		padding: 0 8px 0 16px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--hunk-text);
	}
	.hunk-header {
		background: var(--hunk-bg);
	}
	.hunk-text {
		flex-grow: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hunk-footer {
		justify-content: flex-end;
	}
	.diff > .hunk-footer:last-child {
		border-radius: 0 0 12px 12px;
	}
	.expand {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--faint);
		font-family: var(--sans);
		font-size: 12.5px;
		cursor: pointer;
	}
	.expand:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text);
	}
	.review {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex-shrink: 0;
		height: 30px;
		margin-left: 14px;
		padding: 0 11px;
		border: 0;
		border-radius: 8px;
		background: none;
		box-shadow: inset 0 0 0 1px #3a3c42;
		color: var(--text);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.review.done {
		box-shadow: none;
		color: var(--faint);
	}
	.review:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	.diff > .hunk-header:first-child {
		border-radius: 12px 12px 0 0;
	}
	.row {
		position: relative;
		display: grid;
		grid-template-columns: 48px 48px minmax(0, 1fr);
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
	/* Threads and findings hang off the block's right edge, as folds hang
	   off its left, so the code and its highlights keep the full width. */
	.gutter,
	.fold-pins {
		position: absolute;
		left: calc(100% + 8px);
		top: 2px;
		display: flex;
		gap: 4px;
	}
	.fold-pins {
		top: 50%;
		transform: translateY(-50%);
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
		position: relative;
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
	.composer {
		position: absolute;
		left: 104px;
		top: calc(100% + 6px);
		z-index: 15;
		width: 460px;
		max-width: calc(100% - 120px);
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-radius: 14px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 20px 50px -20px rgba(0, 0, 0, 0.8);
		font-family: var(--sans);
		font-size: 13px;
		white-space: normal;
	}
	.composer-head,
	.composer-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.composer-foot span {
		font-size: 12px;
	}
	.composer textarea {
		resize: vertical;
		padding: 8px 10px;
		border: 0;
		border-radius: 9px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		line-height: 1.5;
		outline: none;
	}
	.composer textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.composer .btn:disabled {
		opacity: 0.5;
	}
	.pin {
		position: relative;
	}
	.unread {
		position: absolute;
		top: -2px;
		right: 0;
		width: 7px;
		height: 7px;
		border-radius: 4px;
		background: var(--you);
		box-shadow: 0 0 0 2px var(--code-bg);
	}
</style>
