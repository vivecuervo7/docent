<script lang="ts">
	import { useSession } from '$lib/session.svelte';
	import type { Note } from '$lib/types';
	import InlineText from './InlineText.svelte';
	import Spinner from './Spinner.svelte';

	// A thread on selected lines: what the reviewer asked or remarked, the
	// model's replies, and room to follow up.
	let { note, onclose }: { note: Note; onclose: () => void } = $props();

	const session = useSession();
	const status = $derived(session.noteStatus[note.id] ?? {});
	const lines = $derived(
		note.start.line === note.end.line ? `line ${note.start.line}` : `lines ${note.start.line}–${note.end.line}`
	);
	let draft = $state('');
	let input = $state<HTMLTextAreaElement | null>(null);

	// Reading it here clears it from unread.
	$effect(() => {
		if (note.messages.at(-1)?.role === 'assistant') session.markNoteRead(note.id);
	});

	function send() {
		const text = draft.trim();
		if (!text || status.pending) return;
		session.sendNote(note.id, text);
		draft = '';
	}

	function remove() {
		if (!confirm('Delete this thread?')) return;
		session.removeNote(note.id);
		onclose();
	}
</script>

<div
	class="popover"
	role="dialog"
	aria-label="Thread"
	tabindex="-1"
	onkeydown={(e) => e.key === 'Escape' && onclose()}
>
	<header>
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="var(--you)" /></svg>
		<span class="who">You</span>
		<span class="faint">{lines}</span>
		<span class="grow"></span>
		<button class="icon" aria-label="Delete thread" title="Delete thread" onclick={remove}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
		</button>
		<button class="icon" aria-label="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>

	<ol class="messages">
		{#each note.messages as m, i (i)}
			<li class={m.role}><InlineText text={m.text} /></li>
		{/each}
	</ol>

	{#if status.pending}
		<p class="status faint"><Spinner size={13} /> Thinking…</p>
	{:else if status.error}
		<p class="status bad">
			Couldn’t get a reply: {status.error}
			<button class="link" onclick={() => session.retryNote(note.id)}>Try again</button>
		</p>
	{/if}

	<div class="reply">
		<textarea
			bind:this={input}
			bind:value={draft}
			rows="2"
			placeholder="Follow up…"
			aria-label="Follow up"
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					send();
				}
			}}
		></textarea>
		<button class="btn primary" disabled={!draft.trim() || status.pending} onclick={send}>Send</button>
	</div>
</div>

<style>
	.popover {
		position: absolute;
		right: 8px;
		top: calc(100% + 6px);
		z-index: 20;
		width: 440px;
		max-width: calc(100vw - 48px);
		box-sizing: border-box;
		padding: 16px 18px;
		border-radius: 16px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 30px 70px -20px rgba(0, 0, 0, 0.7);
		display: flex;
		flex-direction: column;
		gap: 10px;
		white-space: normal;
		font-family: var(--sans);
		cursor: auto;
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.who {
		font-weight: 500;
		color: var(--you-text);
	}
	.grow {
		flex-grow: 1;
	}
	.messages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: 340px;
		overflow-y: auto;
	}
	.messages li {
		font-size: 14px;
		line-height: 1.6;
		white-space: pre-wrap;
	}
	.messages li.user {
		color: var(--text);
	}
	.messages li.assistant {
		color: var(--muted);
		padding-left: 12px;
		box-shadow: inset 2px 0 0 var(--line-2);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
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
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}
	textarea {
		flex-grow: 1;
		min-width: 0;
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
	textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
