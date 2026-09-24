<script lang="ts">
	import { isSliceReviewed, useSession } from '$lib/session.svelte';
	import StateMark from './StateMark.svelte';

	// The slices, down the side while reading, with All files beneath.
	let { current = null, allFiles = false }: { current?: string | null; allFiles?: boolean } = $props();

	const session = useSession();
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
</script>

<nav aria-label="Slices">
	<div class="head"><span class="label">Slices</span><span class="faint count">{session.reviewedSlices} of {session.slices.length}</span></div>
	<ol>
		{#each session.slices as s (s.id)}
			<li>
				<a href="{base}/slices/{s.id}" class:current={s.id === current} aria-current={s.id === current ? 'page' : undefined}>
					<span class="mark"><StateMark state={isSliceReviewed(s, session.reviewed) ? 'done' : s.id === current ? 'now' : 'todo'} /></span>
					<span>{s.title}</span>
				</a>
			</li>
		{/each}
	</ol>
	<a class="all" class:current={allFiles} href="{base}/files" aria-current={allFiles ? 'page' : undefined}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
		All {session.files.length} files
	</a>
</nav>

<style>
	nav {
		position: sticky;
		top: 64px;
		align-self: start;
		height: calc(100vh - 64px);
		box-sizing: border-box;
		padding: 28px 16px;
		border-right: 1px solid var(--line);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0 12px;
	}
	.label {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	.count {
		font-size: 12.5px;
	}
	ol {
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-grow: 1;
	}
	a {
		display: flex;
		gap: 12px;
		padding: 9px 12px;
		border-radius: 10px;
		text-decoration: none;
		color: var(--muted);
		font-size: 14px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	a:hover {
		color: var(--text);
	}
	a.current {
		background: var(--surface-2);
		color: var(--text);
		font-weight: 500;
	}
	.mark {
		padding-top: 1px;
	}
	.all {
		align-items: center;
		margin-top: 16px;
		color: var(--faint);
		font-size: 13.5px;
	}
</style>
