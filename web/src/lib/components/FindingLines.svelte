<script lang="ts">
	import type { Mark } from '$lib/api';
	import { useSession } from '$lib/session.svelte';

	// The few diff lines a finding is about, with a line either side, for
	// deciding on it away from the slice.
	let { mark }: { mark: Pick<Mark, 'path' | 'start' | 'end'> } = $props();
	const session = useSession();

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

{#if rows.length}
	<div class="lines">
		<div class="path">{mark.path}</div>
		{#each rows as r (r.key)}
			<div class="line {r.kind}" class:on={r.on}>
				<span class="n">{r.new ?? r.old}</span><span class="code">{r.text}</span>
			</div>
		{/each}
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
	.n {
		color: var(--line-num);
		text-align: right;
		padding-right: 12px;
	}
</style>
