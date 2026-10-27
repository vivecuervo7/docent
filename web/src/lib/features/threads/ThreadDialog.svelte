<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import NoteText from '$lib/ui/NoteText.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import { timeAgo } from '$lib/ui/format';
	import { useSession } from '$lib/session/session.svelte';
	import Composer, { type SendKind } from '../reading/Composer.svelte';
	import ThreadPanel from '../reading/ThreadPanel.svelte';
	import type { PrThreads } from './prThreads.svelte';
	import { VERDICTS, checkOf, isStale } from './threads';
	import VerdictLabel from './VerdictLabel.svelte';

	// One GitHub thread, looked at closely: the code then and now, all that
	// was said, what checking it found, asking about it, and replying,
	// resolving or reopening there and then. Steps on through the list it
	// was opened from. Asking about it is for a review, where the answer's kept.
	let { threads, id = $bindable(), order, onclose }: { threads: PrThreads; id: string; order: string[]; onclose: () => void } = $props();

	const session = useSession();
	const thread = $derived(threads.threads.find((t) => t.id === id));
	const at = $derived(order.indexOf(id));
	const check = $derived(thread ? checkOf(threads.checks, thread) : undefined);
	const stale = $derived(isStale(check, threads.head));
	const yours = $derived(session?.record.notes.find((n) => n.github === id));

	// The lines it was left on: the end of GitHub's hunk, which stops at them.
	const then = $derived(
		thread?.diffHunk
			?.split('\n')
			.filter((l) => !l.startsWith('@@'))
			.slice(-8) ?? []
	);
	const now = $derived(thread?.now.split('\n').filter(Boolean) ?? []);

	// Long threads show their first and latest comments, the rest folded.
	let showAll = $state(false);
	const entries = $derived(thread?.entries ?? []);
	const folded = $derived(!showAll && entries.length > 3 ? entries.length - 2 : 0);

	// A reply drafted by the check, to edit, until one's written.
	let reply = $state('');
	let replyFor = '';
	$effect(() => {
		if (replyFor === id) return;
		replyFor = id;
		reply = check?.reply ?? '';
		showAll = false;
		error = null;
	});
	$effect(() => {
		if (!reply && check?.reply && replyFor === id) reply = check.reply;
	});

	let busy = $state(false);
	let error = $state<string | null>(null);
	async function act(change: { resolved?: boolean; reply?: string }) {
		if (!thread || busy) return;
		busy = true;
		error = null;
		try {
			await threads.change([{ thread, ...change }]);
			if (change.reply) reply = '';
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	let draft = $state('');
	const ask = (text: string, kind: SendKind) => session?.conversations.askAboutGitHub(id, text, { comment: kind === 'comment', thread });

	function step(by: number) {
		const next = order[at + by];
		if (next) id = next;
	}
	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
		if (e.key === 'j') step(1);
		else if (e.key === 'k') step(-1);
	}
	const diffClass = (line: string) => (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '');
</script>

<svelte:window onkeydown={onKey} />

<Dialog label="GitHub thread" width={860} {onclose}>
	{#if thread}
		<header>
			{#if check?.verdict}
				<VerdictLabel verdict={check.verdict}>{VERDICTS.find((v) => v.verdict === check.verdict)?.label}</VerdictLabel>
			{:else if thread.resolved}
				<VerdictLabel verdict="resolved">Resolved</VerdictLabel>
			{/if}
			{#if order.length > 1}<span class="faint">Thread {at + 1} of {order.length}</span>{/if}
			<span class="grow"></span>
			{#if order.length > 1}
				<button class="link" disabled={at <= 0} onclick={() => step(-1)}>‹ Previous</button>
				<button class="link" disabled={at >= order.length - 1} onclick={() => step(1)}>Next ›</button>
				<span class="faint keys">j / k</span>
			{/if}
			<button class="icon" aria-label="Close" title="Close" onclick={onclose}>
				<Icon name="close" />
			</button>
		</header>

		<p class="where">
			{thread.path}{#if thread.start && thread.end}:{thread.start.line === thread.end.line ? thread.start.line : `${thread.start.line}–${thread.end.line}`}{/if}
			{#if thread.outdated}<span class="faint"> · outdated</span>{/if}
		</p>

		{#if then.length || now.length}
			<div class="code" class:pair={then.length && now.length}>
				{#if then.length}
					<div>
						<span class="faint label">When it was left</span>
						<pre>{#each then as line, i (i)}<span class={diffClass(line)}>{line}</span>{'\n'}{/each}</pre>
					</div>
				{/if}
				{#if now.length}
					<div>
						<span class="faint label">Now</span>
						<pre>{#each now as line, i (i)}<span class={diffClass(line)}>{line}</span>{'\n'}{/each}</pre>
					</div>
				{/if}
			</div>
		{/if}

		<ol class="entries">
			{#each entries as e, i (i)}
				{#if !folded || i === 0 || i >= entries.length - 1}
					<li>
						<span class="who">
							<Avatar src={e.avatar} name={e.author} size={16} />
							{e.author}
							{#if e.author === threads.author}<span class="tag">author</span>{/if}
							{#if e.createdAt}<span class="faint">· {timeAgo(Date.parse(e.createdAt))}</span>{/if}
						</span>
						<div class="text"><NoteText text={e.body} /></div>
					</li>
				{:else if i === 1}
					<li class="fold"><button class="link" onclick={() => (showAll = true)}>{folded} earlier {folded === 1 ? 'reply' : 'replies'}</button></li>
				{/if}
			{/each}
		</ol>

		<div class="check">
			{#if check?.checking}
				<span class="faint"><Spinner size={13} /> Checking…</span>
			{:else if check?.verdict}
				<span class="faint label">Docent · {stale ? 'checked before the latest commits' : 'checked at the latest commit'}</span>
				<p><InlineText text={check.reason ?? ''} /></p>
				{#if stale}<button class="link" onclick={() => threads.check([thread])}>Check it again</button>{/if}
			{:else}
				{#if check?.error}<p class="bad">Couldn’t check: {check.error}</p>{/if}
				<button class="btn" onclick={() => threads.check([thread])}>Check it</button>
			{/if}
			{#if yours}
				<div class="yours"><ThreadPanel note={yours} title="Asked about it" /></div>
			{:else if session}
				<Composer bind:value={draft} placeholder="Ask Docent about this thread…" onsend={ask} />
			{/if}
		</div>

		{#if thread.node}
			<div class="act">
				<textarea rows="2" placeholder="Reply on GitHub…" bind:value={reply} disabled={busy}></textarea>
				{#if error}<p class="bad">{error}</p>{/if}
				<div class="buttons">
					<span class="faint small">{reply && reply === check?.reply ? 'Drafted from the check. ' : ''}Sent to GitHub straight away.</span>
					<span class="grow"></span>
					{#if busy}<Spinner size={13} />{/if}
					<button class="btn" disabled={busy} onclick={() => act({ resolved: !thread.resolved, ...(reply.trim() ? { reply } : {}) })}>
						{reply.trim() ? (thread.resolved ? 'Reply and reopen' : 'Reply and resolve') : thread.resolved ? 'Reopen' : 'Resolve'}
					</button>
					<button class="btn primary" disabled={busy || !reply.trim()} onclick={() => act({ reply })}>Reply</button>
				</div>
			</div>
		{/if}
	{:else}
		<p class="faint">This thread is no longer on GitHub.</p>
	{/if}
</Dialog>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 13px;
	}
	.grow {
		flex-grow: 1;
	}
	.keys {
		font-size: 12px;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		cursor: pointer;
	}
	.link:hover:not(:disabled) {
		color: var(--text);
	}
	.link:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.where {
		margin: 0;
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.code {
		display: grid;
		gap: 12px;
	}
	.code.pair {
		grid-template-columns: 1fr 1fr;
	}
	.code > div {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.label {
		font-size: 12px;
	}
	pre {
		margin: 0;
		padding: 8px 0;
		border-radius: 10px;
		background: var(--code-bg);
		box-shadow: inset 0 0 0 1px var(--line);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 20px;
		color: var(--code-text);
		overflow-x: auto;
	}
	pre span {
		display: inline-block;
		min-width: 100%;
		box-sizing: border-box;
		padding: 0 12px;
	}
	pre .add {
		background: var(--add-bg);
	}
	pre .del {
		background: var(--del-bg);
	}
	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.entries li {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 16px;
		border-top: 1px solid var(--line);
	}
	.entries li:first-child {
		border-top: 0;
	}
	.entries .fold {
		padding: 8px 16px;
		font-size: 12.5px;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--muted);
	}
	/* The PR's own author, as GitHub marks them. */
	.tag {
		padding: 0 6px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--faint);
		font-size: 11px;
		line-height: 16px;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 14px;
		line-height: 1.6;
	}
	.check {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 14px 16px;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.check span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.check p {
		margin: 0;
		font-size: 14px;
		line-height: 1.6;
	}
	.check :global(.composer),
	.yours {
		align-self: stretch;
	}
	.yours {
		border-radius: 10px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		overflow: hidden;
	}
	.act {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	textarea {
		box-sizing: border-box;
		resize: none;
		field-sizing: content;
		min-height: 3.4em;
		max-height: 200px;
		padding: 10px 12px;
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
	.buttons {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.small {
		font-size: 12.5px;
	}
	.bad {
		margin: 0;
		color: var(--danger);
		font-size: 13.5px;
	}
</style>
