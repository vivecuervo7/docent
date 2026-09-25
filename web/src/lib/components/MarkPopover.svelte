<script lang="ts">
	import type { Mark } from '$lib/api';
	import { modelLabel } from '$lib/panel.svelte';
	import { useSession } from '$lib/session.svelte';
	import NoteText from './NoteText.svelte';
	import Spinner from './Spinner.svelte';
	import InlineText from './InlineText.svelte';

	// An agent's finding, to keep for the review or skip, and to ask about
	// first. Shown inside a Floating bubble.
	let { mark, onclose }: { mark: Mark; onclose: () => void } = $props();

	const session = useSession();
	let showWhy = $state(false);
	// What raised it: shown in place of the file, which the bubble sits on.
	const ranWith = $derived(session.record.agentReviewers.find((r) => r.id === mark.reviewer)?.ranWith);
	const model = $derived.by(() => {
		if (!ranWith) return null;
		if (ranWith === 'external') return 'your own agent';
		if (ranWith.startsWith('persona:')) return session.panel.personas.find((p) => `persona:${p.id}` === ranWith)?.name ?? 'a persona';
		return modelLabel(ranWith);
	});
	const isKept = $derived(mark.included ?? true);
	// The finding as saved, for its conversation as it grows.
	const item = $derived(mark.reviewer ? session.record.feedback[mark.reviewer]?.items.find((i) => i.id === mark.id) : undefined);
	const messages = $derived(item?.messages ?? []);
	const status = $derived(session.findingStatus[mark.id] ?? {});
	let draft = $state('');
	let list = $state<HTMLDivElement | null>(null);

	// The latest answer in view as the conversation grows.
	$effect(() => {
		void messages.length;
		void status.pending;
		list?.scrollTo({ top: list.scrollHeight });
	});

	function send() {
		const text = draft.trim();
		if (!text || status.pending || !mark.reviewer) return;
		session.askAboutFinding(mark.reviewer, mark.id, text);
		draft = '';
	}
	const keep = (value: boolean) => mark.reviewer && session.setFindingIncluded(mark.reviewer, mark.id, value);
</script>

<div class="finding" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<header>
		<span class="who">{mark.who}</span>
		<span class="where">{model ?? ''}</span>
		<button class="icon" aria-label="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<div class="content" bind:this={list}>
		<p class="body"><InlineText text={mark.body} /></p>
		{#if mark.rationale}
			<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				Why it was raised
			</button>
			{#if showWhy}<p class="rationale"><InlineText text={mark.rationale} /></p>{/if}
		{/if}
		{#if messages.length || status.pending || status.error}
			<ol class="turns">
				{#each messages as m, i (i)}
					<li class={m.role}>
						<span class="role">{m.role === 'user' ? 'You' : mark.who}</span>
						<div class="text"><NoteText text={m.text} /></div>
					</li>
				{/each}
				{#if status.pending}
					<li class="assistant"><span class="role">{mark.who}</span><p class="state"><Spinner size={13} /> Thinking…</p></li>
				{:else if status.error}
					<li>
						<p class="state bad">
							Couldn’t get an answer: {status.error}
							<button class="link" onclick={() => mark.reviewer && session.retryFinding(mark.reviewer, mark.id)}>Try again</button>
						</p>
					</li>
				{/if}
			</ol>
		{/if}
	</div>
	<div class="ask">
		<textarea
			bind:value={draft}
			rows="1"
			placeholder="Ask about this…"
			aria-label="Ask about this finding"
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					send();
				}
			}}
		></textarea>
	</div>
	<footer>
		<button class="btn" class:primary={isKept} aria-pressed={isKept} onclick={() => keep(true)}>Keep</button>
		<button class="btn" class:primary={!isKept} aria-pressed={!isKept} onclick={() => keep(false)}>Skip</button>
	</footer>
</div>

<style>
	.finding {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 10px 8px 16px;
		border-bottom: 1px solid var(--popover-line);
		font-size: 13px;
	}
	.who {
		font-weight: 500;
		color: var(--agent-text);
		white-space: nowrap;
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
	.content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.body,
	.rationale {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.6;
	}
	.rationale {
		color: var(--muted);
		font-size: 13.5px;
	}
	.why {
		display: flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.turns {
		list-style: none;
		margin: 4px -16px 0;
		padding: 0;
		border-top: 1px solid var(--popover-line);
	}
	.turns li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--popover-line);
	}
	/* The answers sit a shade deeper, so the turns read at a glance. */
	.turns li.assistant {
		background: color-mix(in srgb, var(--popover) 60%, var(--bg));
	}
	.turns li:last-child {
		border-bottom: 0;
	}
	.role {
		font-size: 12px;
		color: var(--faint);
	}
	.turns .text {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 14px;
		line-height: 1.6;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.state.bad {
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
	.ask {
		padding: 0 12px 10px;
	}
	.ask textarea {
		width: 100%;
		box-sizing: border-box;
		resize: none;
		field-sizing: content;
		max-height: 140px;
		padding: 8px 12px;
		border: 0;
		border-radius: 10px;
		background: color-mix(in srgb, var(--popover) 50%, var(--bg));
		box-shadow: inset 0 0 0 1px var(--popover-line);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		line-height: 1.5;
		outline: none;
	}
	.ask textarea:focus {
		box-shadow: inset 0 0 0 1px var(--agent);
	}
	footer {
		display: flex;
		gap: 8px;
		padding: 0 16px 14px;
	}
</style>
