<script lang="ts">
	import { raisedBy, type LooseMark, type Mark } from '$lib/api';
	import { modelLabel } from '$lib/panel.svelte';
	import { namedByKind } from '$lib/reviewers.svelte';
	import { useSession } from '$lib/session.svelte';
	import EditorNotes from './EditorNotes.svelte';
	import NoteText from './NoteText.svelte';
	import SeverityTag from './SeverityTag.svelte';
	import Spinner from './Spinner.svelte';
	import InlineText from './InlineText.svelte';

	// An agent's finding, to keep for the review or skip, and to ask about
	// first. Shown inside a Floating bubble.
	let { mark, onclose }: { mark: Mark | LooseMark; onclose: () => void } = $props();

	const session = useSession();
	let showWhy = $state(false);
	let showAlso = $state(false);
	// Findings separated from this group while it's open, to undo.
	let separated = $state<{ reviewer: string; id: string; where: string }[]>([]);

	function separate(a: NonNullable<Mark['alsoBy']>[number]) {
		session.splitFinding(a.reviewer, a.id);
		const where = a.path ? `${a.path}${a.line ? ` line ${a.line}` : ''}` : 'the PR as a whole';
		separated = [...separated, { reviewer: a.reviewer, id: a.id, where }];
		showAlso = true;
	}

	function undo(s: (typeof separated)[number]) {
		session.mergeBack(s.reviewer, s.id);
		separated = separated.filter((x) => x.id !== s.id);
	}
	// What raised it: shown in place of the file, which the bubble sits on.
	const ranWith = $derived(session.record.agentReviewers.find((r) => r.id === mark.reviewer)?.ranWith);
	const model = $derived.by(() => {
		if (!ranWith) return null;
		if (ranWith === 'external') return 'your own agent';
		const reviewer = session.record.agentReviewers.find((r) => r.id === mark.reviewer);
		const named = !!reviewer && namedByKind(reviewer);
		const external = session.panel.externalName(ranWith);
		if (external) return named ? 'External reviewer' : external;
		return reviewer?.persona && !named ? `${modelLabel(ranWith)} · ${session.panel.personaName(reviewer.persona)}` : modelLabel(ranWith);
	});
	const isKept = $derived(mark.included ?? true);
	// The finding as saved, for its conversation as it grows.
	const item = $derived(mark.reviewer ? session.record.feedback[mark.reviewer]?.items.find((i) => i.id === mark.id) : undefined);
	const messages = $derived(item?.messages ?? []);
	const status = $derived(session.findingStatus[mark.id] ?? {});
	let draft = $state('');
	let list = $state<HTMLDivElement | null>(null);

	// Reading it here clears it from unread.
	$effect(() => {
		void messages.length;
		if (mark.reviewer) session.markFindingRead(mark.reviewer, mark.id);
	});

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
	// Quick questions, each offered until it's been asked.
	const QUICK = [
		{
			label: 'Suggest a fix',
			prompt: "Suggest a fix: the change you'd make, with a short code snippet where it helps. Keep to what this finding needs."
		}
	];
	const quick = $derived(QUICK.filter((q) => !messages.some((m) => m.role === 'user' && m.text === q.label)));

	function ask(q: (typeof QUICK)[number]) {
		if (status.pending || !mark.reviewer) return;
		session.askAboutFinding(mark.reviewer, mark.id, q.label, q.prompt);
	}
	const keep = (value: boolean) => mark.reviewer && session.setFindingIncluded(mark.reviewer, mark.id, value);
</script>

<div class="finding" role="presentation" onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<header>
		<span class="who">{mark.who}</span>
		<SeverityTag severity={item?.severity} />
		<span class="where">{model ?? ''}</span>
		<button class="icon" aria-label="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<div class="content" bind:this={list}>
		<div class="body"><NoteText text={mark.body} /></div>
		<EditorNotes
			impact={item?.impact}
			impactLevel={item?.impactLevel}
			checked={item?.checked}
			checkedVerdict={item?.checkedVerdict}
			speculative={item?.speculative}
			onPr={item?.onPr}
			setAside={item?.setAside}
		/>
		{#if mark.rationale}
			<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				Why it was raised
			</button>
			{#if showWhy}<p class="rationale"><InlineText text={mark.rationale} /></p>{/if}
		{/if}
		{#if mark.separatedFrom && mark.reviewer}
			<p class="separated">
				Separated from {mark.separatedFrom.who}’s finding
				<button class="link small" onclick={() => mark.reviewer && session.mergeBack(mark.reviewer, mark.id)}>Merge back</button>
			</p>
		{/if}
		{#if mark.alsoBy?.length || separated.length}
			{@const also = mark.alsoBy ?? []}
			<div class="also">
				{#if also.length}
					<button class="why" aria-expanded={showAlso} onclick={() => (showAlso = !showAlso)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showAlso ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
						{raisedBy(mark.who, also)}{#if mark.disputed?.length}<span class="disputed" title={mark.disputed.join('\n')}>&nbsp;· they disagree</span>{/if}
					</button>
				{/if}
				{#if showAlso || !also.length}
					<ul>
						{#each also as a, i (a.id)}
							<li>
								{#if a.who !== also[i - 1]?.who}<span class="role">{a.who}</span>{/if}
								<div class="also-body">
									<div class="also-text">
										<p class="rationale"><InlineText text={a.body} /></p>
										{#if a.disputed}<p class="disagrees">Disagrees: <InlineText text={a.disputed} /></p>{/if}
									</div>
									<button class="link small separate" onclick={() => separate(a)}>Separate</button>
								</div>
							</li>
						{/each}
						{#each separated as s (s.id)}
							<li class="separated">
								Now shown on its own at {s.where}
								<button class="link small" onclick={() => undo(s)}>Undo</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
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
		{#if quick.length && !status.pending}
			<div class="quick">
				{#each quick as q (q.label)}
					<button class="chip" onclick={() => ask(q)}>{q.label}</button>
				{/each}
			</div>
		{/if}
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
		{#if item?.skipSuggested && !item.decided}<span class="suggested">Skip suggested: {item.skipSuggested}</span>{/if}
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
	/* A body can hold paragraphs, lists and rules: spaced like a thread. */
	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
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
	.also ul {
		list-style: none;
		margin: 6px 0 0;
		padding: 0 0 0 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.also li {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.chip {
		padding: 4px 11px;
		border: 0;
		border-radius: 999px;
		background: var(--popover);
		box-shadow: 0 0 0 1px var(--popover-line);
		color: var(--muted);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.chip:hover {
		color: var(--text);
		box-shadow: 0 0 0 1px var(--line-2);
	}
	.also-text {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.disagrees {
		margin: 0;
		font-size: 12.5px;
		color: var(--agent);
	}
	.disputed {
		color: var(--agent);
	}
	.suggested {
		flex-basis: 100%;
		font-size: 12.5px;
		color: var(--faint);
	}
	.also-body {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.also-body .rationale {
		margin: 0;
	}
	/* Separating is a correction, offered on the finding being pointed at. */
	.separate {
		flex-shrink: 0;
		opacity: 0;
	}
	.also li:hover .separate,
	.separate:focus-visible {
		opacity: 1;
	}
	.separated {
		margin: 0;
		font-size: 12.5px;
		color: var(--faint);
	}
	.link.small {
		font-size: 12px;
		color: var(--faint);
		text-decoration: none;
	}
	.link.small:hover {
		color: var(--text);
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
		flex-wrap: wrap;
		gap: 8px;
		padding: 0 16px 14px;
	}
</style>
