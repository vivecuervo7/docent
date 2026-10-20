<script lang="ts">
	import { tick } from 'svelte';
	import { useSession } from '$lib/session/session.svelte';
	import { timeAgo } from '$lib/ui/format';
	import { isUnread, type Slice } from '$lib/types';
	import Composer, { type SendKind } from './Composer.svelte';
	import ThreadPanel from './ThreadPanel.svelte';

	// Asking about, or commenting on, the page's subject as a whole - the
	// slice being read, or on the Overview the whole PR - from a corner,
	// with the conversation beside the question. Lines and files are asked
	// about where they are.
	// `above` lifts it clear of a bar along the bottom of the page.
	let { slice, above = 0 }: { slice?: Slice; above?: number } = $props();

	const session = useSession();
	const notes = $derived(session.record.notes.filter((n) => (slice ? n.slice === slice.id : !n.path && !n.slice && !n.github)));
	const unread = $derived(notes.some(isUnread));
	const title = $derived(slice ? 'About this slice' : 'About the whole PR');

	let open = $state(false);
	let draft = $state('');
	let list = $state<HTMLElement | null>(null);

	async function send(text: string, kind: SendKind) {
		session.createNote(slice ? { path: '', slice: slice.id } : { path: '' }, text, { comment: kind === 'comment' });
		await tick();
		list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && open && (open = false)} />

<div class="corner" style:bottom="{24 + above}px">
	{#if open}
		<div class="panel" role="dialog" aria-label={title}>
			<header>
				<span class="title">{title}</span>
				{#if slice}<span class="faint subject">{slice.title}</span>{/if}
				<button class="icon" aria-label="Close" title="Close" onclick={() => (open = false)}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</header>
			<div class="list" bind:this={list}>
				{#each notes as note (note.id)}
					<div class="thread"><ThreadPanel {note} title={timeAgo(note.createdAt)} /></div>
				{:else}
					<p class="faint empty">
						{slice
							? 'Ask about this slice as a whole, or leave a comment on it for the review.'
							: 'Ask about the PR as a whole, or leave a comment for the review.'}
						Lines and files are asked about where they are.
					</p>
				{/each}
			</div>
			<div class="write">
				<Composer bind:value={draft} autofocus placeholder={slice ? 'Ask about this slice, or comment on it…' : 'Ask about the PR, or comment on it…'} onsend={send} />
			</div>
		</div>
	{/if}
	<button class="bubble" class:on={open} aria-expanded={open} aria-label="{title}{notes.length ? `, ${notes.length}` : ''}" title={title} onclick={() => (open = !open)}>
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg>
		{#if notes.length}<span class="count" class:unread>{notes.length}</span>{/if}
	</button>
</div>

<style>
	.corner {
		position: fixed;
		z-index: 40;
		right: 24px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 12px;
	}
	.bubble {
		position: relative;
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border: 0;
		border-radius: 50%;
		background: var(--surface-2);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 12px 32px -12px rgba(0, 0, 0, 0.8);
		color: var(--you-text);
		cursor: pointer;
	}
	.bubble:hover,
	.bubble.on {
		background: var(--you-chip);
	}
	.count {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		box-sizing: border-box;
		border-radius: 999px;
		background: var(--line-2);
		color: var(--text);
		font-size: 11px;
		line-height: 18px;
		text-align: center;
	}
	.count.unread {
		background: var(--you);
		color: #0f1420;
	}
	.panel {
		width: 440px;
		max-width: calc(100vw - 48px);
		max-height: min(640px, calc(100vh - 180px));
		display: flex;
		flex-direction: column;
		border-radius: 16px;
		background: var(--surface);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 32px 80px -24px rgba(0, 0, 0, 0.85);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 12px 10px 10px 16px;
		border-bottom: 1px solid var(--line-2);
	}
	.title {
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
	}
	.subject {
		flex: 1;
		min-width: 0;
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	header .icon {
		margin-left: auto;
		align-self: center;
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
	}
	.thread {
		flex: none;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		overflow: hidden;
	}
	.empty {
		margin: 4px;
		font-size: 13.5px;
		line-height: 1.55;
	}
	.write {
		padding: 12px;
		border-top: 1px solid var(--line-2);
	}
</style>
