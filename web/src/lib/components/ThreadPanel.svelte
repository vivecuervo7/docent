<script lang="ts">
	import { ask } from '$lib/confirm.svelte';
	import { useSession } from '$lib/session.svelte';
	import type { Note } from '$lib/types';
	import NoteText from './NoteText.svelte';
	import Spinner from './Spinner.svelte';

	// A thread on selected lines: what the reviewer asked or remarked, the
	// model's replies, and room to follow up. Shown inside a Floating bubble.
	let { note, onclose }: { note: Note; onclose: () => void } = $props();

	const session = useSession();
	const status = $derived(session.noteStatus[note.id] ?? {});
	const lines = $derived(
		note.start.line === note.end.line ? `line ${note.start.line}` : `lines ${note.start.line}–${note.end.line}`
	);
	let draft = $state('');
	let list = $state<HTMLOListElement | null>(null);

	// Reading it here clears it from unread.
	$effect(() => {
		if (note.messages.at(-1)?.role === 'assistant') session.markNoteRead(note.id);
	});

	// The latest message in view as the thread grows.
	$effect(() => {
		void note.messages.length;
		void status.pending;
		list?.scrollTo({ top: list.scrollHeight });
	});

	function send() {
		const text = draft.trim();
		if (!text || status.pending) return;
		session.sendNote(note.id, text);
		draft = '';
	}

	async function remove() {
		if (!(await ask({ title: 'Delete this thread?', body: 'Its messages go with it.', action: 'Delete' }))) return;
		session.removeNote(note.id);
		onclose();
	}
</script>

<div class="thread" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<header>
		<span class="where">{note.path.split('/').pop()} · {lines}</span>
		<button class="icon" aria-label="Delete thread" title="Delete thread" onclick={remove}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
		</button>
		<button class="icon" aria-label="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>

	<ol class="messages" bind:this={list}>
		{#each note.messages as m, i (i)}
			<li class={m.role}>
				<span class="role">{m.role === 'user' ? 'You' : 'Docent'}</span>
				<div class="text"><NoteText text={m.text} /></div>
			</li>
		{/each}
		{#if status.pending}
			<li class="assistant"><span class="role">Docent</span><p class="status faint"><Spinner size={13} /> Thinking…</p></li>
		{:else if status.error}
			<li>
				<p class="status bad">
					Couldn’t get a reply: {status.error}
					<button class="link" onclick={() => session.retryNote(note.id)}>Try again</button>
				</p>
			</li>
		{/if}
	</ol>

	<div class="reply">
		<textarea
			bind:value={draft}
			rows="1"
			placeholder="Reply…"
			aria-label="Reply"
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					send();
				}
			}}
		></textarea>
	</div>
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
	/* Docent's replies sit on half the agent brown, so the turns read at a glance. */
	.messages li.assistant {
		background: color-mix(in srgb, var(--popover) 50%, var(--surface-2));
	}
	.role {
		font-size: 12px;
		color: var(--faint);
	}
	.messages p {
		margin: 0;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 14px;
		line-height: 1.6;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.status.bad {
		color: var(--danger);
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.reply {
		padding: 12px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: none;
		field-sizing: content;
		max-height: 160px;
		padding: 9px 12px;
		border: 0;
		border-radius: 10px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		line-height: 1.5;
		outline: none;
	}
	textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
</style>
