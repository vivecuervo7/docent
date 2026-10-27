<script lang="ts">
	import { ask } from '$lib/ui/confirm.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import { noteWhere, type Note } from '$lib/types';
	import NoteText from '../../ui/NoteText.svelte';
	import Spinner from '../../ui/Spinner.svelte';
	import Composer, { type SendKind } from './Composer.svelte';

	// A thread on selected lines, a whole file or the PR: what the reviewer asked, the model's
	// replies, the comments they mean to post as written, and room to follow
	// up. Shown inside a Floating bubble.
	// Without `onclose` it sits in the page rather than a bubble, with nothing to close.
	// `title` names it in place of where it sits.
	let { note, title, onclose }: { note: Note; title?: string; onclose?: () => void } = $props();

	const session = useSession();
	const status = $derived(session.conversations.noteStatus[note.id] ?? {});
	const where = $derived(noteWhere(note));
	let draft = $state('');
	// A thread begun with a comment takes more comments; one begun with a
	// question is closed with a conclusion.
	const second = $derived(note.messages[0]?.comment ? 'comment' : 'conclude');

	function send(text: string, kind: SendKind) {
		session.conversations.sendNote(note.id, text, { comment: kind === 'comment', conclusion: kind === 'conclude' });
	}
	let list = $state<HTMLOListElement | null>(null);

	// Reading it here clears it from unread.
	$effect(() => {
		if (note.messages.at(-1)?.role === 'assistant') session.conversations.markNoteRead(note.id);
	});

	// The latest message in view as the thread grows.
	$effect(() => {
		void note.messages.length;
		void status.pending;
		list?.scrollTo({ top: list.scrollHeight });
	});

	async function remove() {
		if (!(await ask({ title: 'Delete this thread?', body: 'Its messages go with it.', action: 'Delete' }))) return;
		session.conversations.removeNote(note.id);
		onclose?.();
	}
</script>

<div class="thread" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose?.()}>
	<header>
		<span class="where">{title ?? (note.path ? `${note.path.split('/').pop()} · ${where}` : note.slice ? 'This slice as a whole' : 'The PR as a whole')}</span>
		<button class="icon" aria-label="Delete thread" title="Delete thread" onclick={remove}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
		</button>
		{#if onclose}
			<button class="icon" aria-label="Close" title="Close" onclick={onclose}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>
		{/if}
	</header>

	<ol class="messages" bind:this={list}>
		{#each note.messages as m, i (i)}
			<li class={m.role} class:comment={m.comment} class:conclusion={m.conclusion}>
				<span class="role">
					{#if m.comment}Your comment <span class="as-written">· posted as written</span>{:else if m.conclusion}Your conclusion
						<span class="faint">· not posted; drafting follows it</span>{:else}{m.role === 'user' ? 'You' : 'Docent'}{/if}
				</span>
				<div class="text"><NoteText text={m.text} /></div>
			</li>
		{/each}
		{#if status.pending}
			<li class="assistant"><span class="role">Docent</span><p class="status faint"><Spinner size={13} /> Thinking…</p></li>
		{:else if status.error}
			<li>
				<p class="status bad">
					Couldn’t get a reply: {status.error}
					<button class="link" onclick={() => session.conversations.retryNote(note.id)}>Try again</button>
				</p>
			</li>
		{/if}
	</ol>

	<div class="reply">
		<Composer
			bind:value={draft}
			placeholder={second === 'comment' ? 'Ask, or comment…' : 'Ask, or conclude…'}
			{second}
			askDisabled={status.pending}
			onsend={send}
		/>
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
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.as-written {
		color: var(--you);
	}
</style>
