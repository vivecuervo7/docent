<script lang="ts">
	import type { GitHubThread } from '$lib/types';
	import { useSession } from '$lib/session/session.svelte';
	import { timeAgo } from '$lib/ui/format';
	import Avatar from '../../ui/Avatar.svelte';
	import NoteText from '../../ui/NoteText.svelte';
	import ThreadPanel from './ThreadPanel.svelte';

	// A thread someone left on GitHub, beside the code it's on: read here as
	// it is there, with your own thread about it. It's acted on from the
	// Overview.
	let { thread, onclose }: { thread: GitHubThread; onclose: () => void } = $props();

	const session = useSession();
	const yours = $derived(session.record.notes.find((n) => n.github === thread.id));

	const where = $derived.by(() => {
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

<div class="thread" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<header>
		<span class="where">{where}</span>
		<button class="icon" aria-label="Close" title="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<div class="state">
		<span class="faint">{thread.resolved ? 'Resolved on GitHub' : 'Open on GitHub'}</span>
		<a class="link" href="{session.base}?thread={thread.id}">Open on the Overview</a>
	</div>
	<ol class="messages">
		{#each thread.entries as e, i (i)}
			<li>
				<span class="role">
					<Avatar src={e.avatar} name={e.author} size={18} />
					{e.author}
					{#if e.author === session.meta?.author}<span class="tag">author</span>{/if}
					{#if e.createdAt}<span class="faint">· {timeAgo(Date.parse(e.createdAt))}</span>{/if}
				</span>
				<div class="text"><NoteText text={e.body} /></div>
			</li>
		{/each}
	</ol>
	{#if yours}
		<div class="yours"><ThreadPanel note={yours} title="Your thread about it" /></div>
	{/if}
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
	.state {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--line);
		font-size: 12.5px;
	}
	.state {
		flex-wrap: wrap;
	}
	.state .link {
		margin-left: auto;
		border: 0;
		background: none;
		padding: 0;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
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
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--muted);
	}
	.tag {
		padding: 0 6px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--faint);
		font-size: 11px;
		line-height: 16px;
	}
	.yours {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-2);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 14px;
		line-height: 1.6;
	}
</style>
