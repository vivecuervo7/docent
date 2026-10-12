<script lang="ts">
	import type { GitHubEntry, GitHubThread } from '$lib/types';
	import { timeAgo } from '$lib/ui/format';
	import NoteText from '../../ui/NoteText.svelte';

	// What someone said on GitHub: an inline thread, or a comment on the PR
	// as a whole. Read here as it is there; it's theirs, not the review's.
	// Without `onclose` it sits in the page rather than a bubble.
	let {
		thread,
		entries = thread?.entries ?? [],
		onclose
	}: {
		thread?: GitHubThread;
		entries?: GitHubEntry[];
		onclose?: () => void;
	} = $props();

	const where = $derived.by(() => {
		if (!thread) return 'On GitHub';
		const file = thread.path.split('/').pop();
		if (thread.start && thread.end) {
			const { line: a } = thread.start;
			const { line: b } = thread.end;
			return `${file} · ${a === b ? `line ${a}` : `lines ${a}–${b}`} · on GitHub`;
		}
		if (thread.outdated) return `${file} · outdated${thread.originalLine ? `, left on line ${thread.originalLine}` : ''} · on GitHub`;
		return `${file} · the whole file · on GitHub`;
	});
</script>

<div class="thread" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose?.()}>
	<header>
		<span class="where">{where}</span>
		{#if onclose}
			<button class="icon" aria-label="Close" title="Close" onclick={onclose}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>
		{/if}
	</header>
	<ol class="messages">
		{#each entries as e, i (i)}
			<li>
				<span class="role">{e.author}{#if e.createdAt}<span class="faint">{` · ${timeAgo(Date.parse(e.createdAt))}`}</span>{/if}</span>
				<div class="text"><NoteText text={e.body} /></div>
			</li>
		{/each}
	</ol>
</div>

<style>
	.thread {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	header {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 22px;
		padding: 10px 10px 8px 16px;
		border-bottom: 1px solid var(--line-2);
	}
	.where {
		flex-grow: 1;
		min-width: 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.messages {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.messages li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.messages li:last-child {
		border-bottom: 0;
	}
	.role {
		font-size: 12px;
		color: var(--muted);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 14px;
		line-height: 1.6;
	}
</style>
