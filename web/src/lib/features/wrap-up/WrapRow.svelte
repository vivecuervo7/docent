<script lang="ts">
	import { raisedBy } from '../panel/findings';
	import FilePath from '../../ui/FilePath.svelte';
	import EditorNotes from '../panel/EditorNotes.svelte';
	import SeverityTag from '../panel/SeverityTag.svelte';
	import type { Severity } from '$lib/types';
	import type { LineRef } from '$lib/types';
	import type { NoteMessage } from '$lib/types';
	import NoteText from '../../ui/NoteText.svelte';
	import FindingLines from '../posting/FindingLines.svelte';

	// One thing that could go into the review: an agent's finding or one of
	// your drafted comments, with keep or skip.
	let {
		kind,
		who,
		path,
		start,
		end,
		body,
		rationale,
		messages = [],
		alsoBy = [],
		speculative,
		onPr,
		setAside,
		skipSuggested,
		notes,
		suggested = false,
		severity,
		// The choice that stands: yours, or the panel's while it's unconfirmed.
		kept,
		onkeep,
		onskip,
		changed = false,
		onredraft
	}: {
		kind: 'finding' | 'yours';
		// Who raised it; your own comments go without.
		who?: string;
		path?: string;
		start?: LineRef;
		end?: LineRef;
		body: string;
		rationale?: string;
		// Questions asked about it in the diff, and the answers.
		messages?: NoteMessage[];
		// Other reviewers' findings making the same point.
		alsoBy?: { who: string; body: string }[];
		// What it assumes, when nothing settles it.
		speculative?: string;
		// The PR thread already raising it.
		onPr?: string;
		// Why its reviewer set it aside before handing it back.
		setAside?: string;
		// Why the editor suggests skipping it, while undecided.
		skipSuggested?: string;
		// What the editor found, folded behind its verdicts.
		notes?: { impact?: string; impactLevel?: string; checked?: string; checkedVerdict?: string };
		// Whether the choice shown is the panel's, not yet confirmed by you.
		suggested?: boolean;
		severity?: Severity;
		kept: boolean | null;
		onkeep: () => void;
		onskip: () => void;
		// One of yours whose threads have changed since it was drafted.
		changed?: boolean;
		onredraft?: () => void;
	} = $props();

	let showWhy = $state(false);
	let showTalk = $state(false);
	let showAlso = $state(false);

	let showingDiff = $state(false);
	const lines = $derived.by(() => {
		if (!start) return undefined;
		const endLine = end?.line ?? start.line;
		return start.line === endLine ? `line ${start.line}` : `lines ${start.line}–${endLine}`;
	});
</script>

<li class="row" class:skipped={kept === false && !suggested}>
	<div class="text">
		<div class="head">
			{#if who}<span class="who">{who}</span>{/if}
			<SeverityTag {severity} />
			{#if skipSuggested && suggested}<span class="speculative" title="Skip suggested: {skipSuggested}">Skip suggested</span>{/if}
			{#if path}<span class="where"><FilePath {path} {lines} /></span>{/if}
			{#if changed}
				<span class="changed">changed since drafted</span>
				{#if onredraft}<button class="redraft" onclick={onredraft}>Redraft</button>{/if}
			{/if}
		</div>
		<div class="body"><NoteText text={body} /></div>
		<EditorNotes {...notes} speculative={notes ? speculative : undefined} {onPr} {setAside} fontSize={12.5} chevron={13} tone="faint" />
		{#if rationale}
			<button class="why" aria-expanded={showWhy} onclick={() => (showWhy = !showWhy)}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showWhy ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				{kind === 'finding' ? 'Why it was raised' : 'Why it was drafted'}
			</button>
			{#if showWhy}<div class="rationale"><NoteText text={rationale} /></div>{/if}
		{/if}
		{#if alsoBy.length}
			<button class="why" aria-expanded={showAlso} onclick={() => (showAlso = !showAlso)}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showAlso ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				{raisedBy(who ?? 'This reviewer', alsoBy)}
			</button>
			{#if showAlso}
				<ol class="talk">
					{#each alsoBy as a, i (i)}
						<li>
							{#if a.who !== alsoBy[i - 1]?.who}<span class="role">{a.who}</span>{/if}
							<div class="rationale-text"><NoteText text={a.body} /></div>
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
		{#if messages.length}
			<button class="why" aria-expanded={showTalk} onclick={() => (showTalk = !showTalk)}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={showTalk ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
				{messages.length} {messages.length === 1 ? 'message' : 'messages'} about it
			</button>
			{#if showTalk}
				<ol class="talk">
					{#each messages as m, i (i)}
						<li class={m.role}>
							<span class="role">{m.role === 'user' ? 'You' : who}</span>
							<div class="rationale-text"><NoteText text={m.text} /></div>
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
	</div>
	<div class="decide" role="group" aria-label="Keep or skip{suggested ? ', as the panel suggests' : ''}">
		<button class="keep" class:on={kept === true} class:suggested aria-pressed={kept === true} onclick={onkeep}>Keep</button>
		<button class="skip" class:on={kept === false} class:suggested aria-pressed={kept === false} onclick={onskip}>Skip</button>
	</div>
	{#if path && start}
		<div class="foot">
			<button class="link diff-toggle" class:open={showingDiff} aria-expanded={showingDiff} onclick={() => (showingDiff = !showingDiff)}>{showingDiff ? 'Hide diff' : 'Show diff'}</button>
		</div>
	{/if}
	{#if showingDiff && path && start}
		<div class="diff">
			<FindingLines mark={{ path, start, end: end ?? start }} />
		</div>
	{/if}
</li>


<style>
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: 8px 24px;
		padding: 16px 16px 16px 18px;
		border-top: 1px solid var(--line);
	}
	.row:first-child {
		border-top: 0;
	}
	/* A skip fades the row; Keep's own fill says it's kept. */
	.row.skipped > .text,
	.row.skipped > .foot {
		opacity: 0.55;
	}
	.changed {
		color: var(--agent);
		white-space: nowrap;
	}
	.redraft {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		font-size: 12.5px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.redraft:hover {
		color: var(--text);
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
		font-size: 13px;
	}
	.who {
		color: var(--muted);
		white-space: nowrap;
	}
	.speculative {
		padding: 1px 7px;
		border-radius: 999px;
		box-shadow: 0 0 0 1px var(--line-2);
		color: var(--faint);
		font-size: 11.5px;
		white-space: nowrap;
	}
	.where {
		min-width: 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Under both columns, so Show diff ends where Keep and Skip do. */
	.foot {
		grid-column: 1 / -1;
		display: flex;
		justify-content: flex-end;
	}
	.diff {
		grid-column: 1 / -1;
	}
	.diff-toggle.open {
		color: var(--text);
	}
	.link {
		margin-left: auto;
		flex-shrink: 0;
		border: 0;
		background: none;
		padding: 0;
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.body,
	.rationale {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14.5px;
		line-height: 1.6;
	}
	/* The agent's own reasoning, on the half brown of Docent's thread replies. */
	.rationale {
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--popover) 50%, var(--surface-2));
		color: var(--muted);
		font-size: 13.5px;
	}
	.talk {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: 10px;
		overflow: hidden;
		background: color-mix(in srgb, var(--popover) 50%, var(--surface-2));
	}
	.talk li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 14px;
		border-top: 1px solid var(--popover-line);
	}
	.talk li:first-child {
		border-top: 0;
	}
	.talk li.assistant {
		background: color-mix(in srgb, var(--popover) 60%, var(--bg));
	}
	.talk .role {
		font-size: 12px;
		color: var(--faint);
	}
	.rationale-text {
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--muted);
		font-size: 13.5px;
		line-height: 1.6;
	}
	.why {
		display: flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.decide {
		flex-shrink: 0;
		display: flex;
		padding: 2px;
		border-radius: 9px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.decide button {
		height: 28px;
		padding: 0 12px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	/* Your choice fills its half; the panel's, standing until you make
	   one, is only outlined. */
	.decide button.on {
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
	}
	.decide button.keep.on {
		background: var(--done-bg);
		box-shadow: none;
		color: var(--done);
	}
	.decide button.on.suggested {
		background: none;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
	}
</style>
