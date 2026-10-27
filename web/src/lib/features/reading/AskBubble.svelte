<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import { onDismiss } from '$lib/ui/dismiss';
	import { tick } from 'svelte';
	import { ask } from '$lib/ui/confirm.svelte';
	import NoteText from '$lib/ui/NoteText.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import { isUnread, type Slice } from '$lib/types';
	import Composer, { type SendKind } from './Composer.svelte';

	// One running conversation about the page's subject as a whole - the
	// slice being read, or on the Overview the whole PR - from a corner of
	// the screen. Lines and files are asked about where they are.
	// It's kept as the subject's thread, carried on with each message; one
	// begun as several threads reads as one, carried on in the latest.
	let { slice }: { slice?: Slice } = $props();

	const session = useSession();
	const notes = $derived(
		session.record.notes
			.filter((n) => (slice ? n.slice === slice.id : !n.path && !n.slice && !n.github))
			.sort((a, b) => a.createdAt - b.createdAt)
	);
	const latest = $derived(notes.at(-1));
	const messages = $derived(notes.flatMap((n) => n.messages));
	const status = $derived(latest ? (session.conversations.noteStatus[latest.id] ?? {}) : {});
	const unread = $derived(notes.some(isUnread));
	const title = $derived(slice ? 'About this slice' : 'About the whole PR');

	let open = $state(false);
	let draft = $state('');
	let list = $state<HTMLElement | null>(null);
	let corner = $state<HTMLElement | null>(null);
	// The page's scrollbar adds to the space on its right; the same below
	// sets it as far from the window's corner each way.
	let scrollbar = $state(0);
	const measure = () => {
		scrollbar = window.innerWidth - Math.min(document.documentElement.clientWidth, document.body.clientWidth);
	};
	// The page growing or shrinking can bring the scrollbar or take it away.
	$effect(() => {
		const observer = new ResizeObserver(measure);
		observer.observe(document.body);
		return () => observer.disconnect();
	});

	function send(text: string, kind: SendKind) {
		const comment = kind === 'comment';
		if (latest) session.conversations.sendNote(latest.id, text, { comment, conclusion: kind === 'conclude' });
		else session.conversations.createNote(slice ? { path: '', slice: slice.id } : { path: '' }, text, { comment });
	}

	async function clear() {
		if (!(await ask({ title: 'Clear this conversation?', body: 'What’s been drafted from it in Wrap up goes with it.', action: 'Clear' }))) return;
		for (const n of notes) session.conversations.removeNote(n.id);
	}

	// Read while it's open; the latest message kept in view as it grows.
	$effect(() => {
		if (!open) return;
		for (const n of notes) if (isUnread(n)) session.conversations.markNoteRead(n.id);
	});
	$effect(() => {
		void messages.length;
		void status.pending;
		if (open) tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
	});

	// Asked to show it, from Wrap up: it opens.
	$effect(() => {
		const id = session.revealing;
		if (id && notes.some((n) => n.id === id)) {
			session.revealing = null;
			open = true;
		}
	});

	// A click anywhere else, or Escape, closes it; not one in the dialog
	// Clear asks with.
	$effect(() => {
		if (!open) return;
		return onDismiss(() => (open = false), (target) => !!corner?.contains(target) || !!target.closest('[role="dialog"], [role="alertdialog"], .scrim'));
	});
</script>

<svelte:window onresize={measure} />

<div class="corner" bind:this={corner} style:bottom="{24 + scrollbar}px">
	{#if open}
		<div class="panel" class:full={messages.length || status.pending} role="dialog" aria-label={title}>
			<header>
				<span class="title">{title}</span>
				{#if slice}<span class="faint subject">{slice.title}</span>{/if}
				<span class="grow"></span>
				{#if notes.length}<button class="clear" onclick={clear}>Clear</button>{/if}
				<button class="icon" aria-label="Close" title="Close" onclick={() => (open = false)}>
					<Icon name="close" />
				</button>
			</header>
			<ol class="messages" bind:this={list}>
				{#each messages as m, i (i)}
					<li class={m.role}>
						<span class="role">
							{#if m.comment}Your comment <span class="as-written">· posted as written</span>{:else if m.conclusion}Your conclusion
								<span class="faint">· not posted; drafting follows it</span>{:else}{m.role === 'user' ? 'You' : 'Docent'}{/if}
						</span>
						<div class="text"><NoteText text={m.text} /></div>
					</li>
				{:else}
					<li class="empty faint">
						{slice
							? 'Ask about this slice as a whole, or leave a comment on it for the review.'
							: 'Ask about the PR as a whole, or leave a comment for the review.'}
						Lines and files are asked about where they are.
					</li>
				{/each}
				{#if status.pending}
					<li class="assistant"><span class="role">Docent</span><p class="status faint"><Spinner size={13} /> Thinking…</p></li>
				{:else if status.error && latest}
					<li>
						<p class="status bad">
							Couldn’t get a reply: {status.error}
							<button class="link" onclick={() => session.conversations.retryNote(latest.id)}>Try again</button>
						</p>
					</li>
				{/if}
			</ol>
			<div class="write">
				<Composer
					bind:value={draft}
					autofocus
					second={latest ? 'both' : 'comment'}
					askDisabled={status.pending}
					placeholder={slice ? 'Ask about this slice, or comment on it…' : 'Ask about the PR, or comment on it…'}
					onsend={send}
				/>
			</div>
		</div>
	{/if}
	<button class="bubble" class:on={open} aria-expanded={open} aria-label="{title}{unread ? ', new answer' : ''}" {title} onclick={() => (open = !open)}>
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg>
		{#if unread}<span class="dot"></span>{/if}
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
			var(--shadow-small);
		color: var(--you-text);
		cursor: pointer;
	}
	.bubble:hover,
	.bubble.on {
		background: var(--you-chip);
	}
	/* A new answer not yet read. */
	.dot {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--you);
		box-shadow: 0 0 0 2px var(--bg);
	}
	.panel {
		width: 520px;
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
	/* Empty, it's as tall as its prompt; once there's a conversation it
	   takes its full height, so answers arriving don't keep resizing it. */
	.panel.full {
		height: min(640px, calc(100vh - 180px));
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 10px 10px 16px;
		border-bottom: 1px solid var(--line-2);
	}
	.title {
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
	}
	.subject {
		min-width: 0;
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.grow {
		flex-grow: 1;
	}
	.clear {
		border: 0;
		background: none;
		padding: 0 4px;
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.clear:hover {
		color: var(--text);
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
	/* Docent's replies sit on half the agent brown, as in a thread on lines. */
	.messages li.assistant {
		background: color-mix(in srgb, var(--popover) 50%, var(--surface-2));
	}
	.messages li.empty {
		border-bottom: 0;
		font-size: 13.5px;
		line-height: 1.55;
	}
	.role {
		font-size: 12px;
		color: var(--faint);
	}
	.as-written {
		color: var(--you);
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
	.write {
		padding: 12px;
		border-top: 1px solid var(--line-2);
	}
</style>
