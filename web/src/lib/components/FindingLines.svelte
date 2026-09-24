<script lang="ts">
	import type { Mark } from '$lib/api';
	import { useSession } from '$lib/session.svelte';

	// The few diff lines a finding is about, with a line either side, for
	// deciding on it away from the slice.
	let { mark }: { mark: Pick<Mark, 'path' | 'start' | 'end'> } = $props();
	const session = useSession();

	// A long range shows its first and last few lines, folded between.
	const LONG = 10;
	const EDGE = 3;
	const key = $derived(`${mark.path}:${mark.start.side}${mark.start.line}-${mark.end.line}`);
	const open = $derived(session.openExcerpts.has(key));

	const rows = $derived.by(() => {
		for (const h of session.hunks.get(mark.path) ?? []) {
			const at = (line: number) =>
				h.rows.findIndex((r) => (mark.start.side === 'new' ? r.kind !== 'del' && r.new === line : r.kind !== 'add' && r.old === line));
			const from = at(mark.start.line);
			if (from < 0) continue;
			const to = Math.max(from, at(mark.end.line));
			return h.rows.slice(Math.max(0, from - 1), to + 2).map((r, i) => ({ ...r, on: i + Math.max(0, from - 1) >= from && i + Math.max(0, from - 1) <= to }));
		}
		return [];
	});
</script>

{#snippet line(r: (typeof rows)[number])}
	<div class="line {r.kind}" class:on={r.on}>
		<span class="n">{r.new ?? r.old}</span><span class="code">{r.text}</span>
	</div>
{/snippet}

{#if rows.length}
	{@const first = rows.findIndex((r) => r.on)}
	{@const last = rows.findLastIndex((r) => r.on)}
	{@const folds = last - first + 1 > LONG}
	{@const hidden = rows.slice(first + EDGE, last + 1 - EDGE)}
	{@const added = hidden.filter((r) => r.kind === 'add').length}
	{@const removed = hidden.filter((r) => r.kind === 'del').length}
	<div class="lines">
		<div class="path">{mark.path}</div>
		{#if folds}
			{#each rows.slice(0, first + EDGE) as r (r.key)}{@render line(r)}{/each}
			<button class="fold-row" aria-expanded={open} onclick={() => (open ? session.openExcerpts.delete(key) : session.openExcerpts.add(key))}>
				<svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true" style:transform={open ? 'rotate(90deg)' : ''}><path d="M7 4l12 8-12 8z" fill="currentColor" /></svg>
				<span>…</span>
				{#if !open}
					<span class="changes">
						{#if added || removed}{#if added}<span class="plus">+{added}</span>{/if} {#if removed}<span class="minus">−{removed}</span>{/if}{:else}{hidden.length} unchanged lines{/if}
					</span>
				{/if}
			</button>
			{#if open}{#each hidden as r (r.key)}{@render line(r)}{/each}{/if}
			{#each rows.slice(last + 1 - EDGE) as r (r.key)}{@render line(r)}{/each}
		{:else}
			{#each rows as r (r.key)}{@render line(r)}{/each}
		{/if}
	</div>
{/if}

<style>
	.lines {
		border-radius: 10px;
		overflow: hidden;
		background: var(--code-bg);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 21px;
	}
	.path {
		padding: 6px 12px;
		background: var(--hunk-bg);
		color: var(--hunk-text);
	}
	.line {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		tab-size: 4;
		color: var(--code-text);
	}
	.line.add {
		background: var(--add-bg);
	}
	.line.del {
		background: var(--del-bg);
	}
	.line.on .code {
		background-image: linear-gradient(var(--agent-tint), var(--agent-tint));
	}
	.fold-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 26px;
		padding: 0 12px 0 18px;
		border: 0;
		background: var(--hunk-bg);
		color: var(--muted);
		font-family: var(--mono);
		font-size: 12px;
		cursor: pointer;
	}
	.fold-row:hover {
		color: var(--text);
	}
	.changes {
		margin-left: auto;
	}
	.plus {
		color: var(--plus-dull);
	}
	.minus {
		color: var(--minus-dull);
	}
	.n {
		color: var(--line-num);
		text-align: right;
		padding-right: 12px;
	}
</style>
