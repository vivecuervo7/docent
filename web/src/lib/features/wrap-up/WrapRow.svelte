<script lang="ts">
	import { raisedBy } from '../panel/findings';
	import FilePath from '../../ui/FilePath.svelte';
	import Verdicts from './Verdicts.svelte';
	import KeepSkip from '../../ui/KeepSkip.svelte';
	import SeverityTag from '../panel/SeverityTag.svelte';
	import type { Severity } from '$lib/types';
	import type { LineRef } from '$lib/types';
	import type { NoteMessage } from '$lib/types';
	import NoteText from '../../ui/NoteText.svelte';

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
		raisedBefore,
		outsideRound = false,
		notes,
		suggested = false,
		severity,
		// The choice that stands: yours, or the panel's while it's unconfirmed.
		kept,
		onkeep,
		onskip,
		onshow,
		showLabel = 'Show in slice',
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
		// The earlier round that raised the same point and kept it.
		raisedBefore?: number;
		// A major one or a blocker on lines this round didn't change.
		outsideRound?: boolean;
		// What the editor found, folded behind its verdicts.
		notes?: { impact?: string; impactLevel?: string; checked?: string; checkedVerdict?: string };
		// Whether the choice shown is the panel's, not yet confirmed by you.
		suggested?: boolean;
		severity?: Severity;
		kept: boolean | null;
		onkeep: () => void;
		onskip: () => void;
		// Opens it where it was raised.
		onshow?: () => void;
		// Where showing it goes, when that isn't a slice.
		showLabel?: string;
		// One of yours whose threads have changed since it was drafted.
		changed?: boolean;
		onredraft?: () => void;
	} = $props();

	let showTalk = $state(false);
	const hasVerdicts = $derived(!!(notes?.impact || notes?.checked || (notes && speculative) || onPr || setAside));
	let showAlso = $state(false);

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
			{#if outsideRound}<span class="speculative" title="On lines this round's commits didn't change">Outside this round</span>{/if}
			{#if raisedBefore}<span class="speculative" title="Raised in round {raisedBefore} too, and kept: it may not have been fixed">Raised again</span>{/if}
			{#if skipSuggested && suggested}<span class="speculative" title="Skip suggested: {skipSuggested}">Skip suggested</span>{/if}
			{#if path}<span class="where"><FilePath {path} {lines} /></span>{/if}
			{#if changed}
				<span class="changed">changed since drafted</span>
				{#if onredraft}<button class="redraft" onclick={onredraft}>Redraft</button>{/if}
			{/if}
		</div>
		<div class="body"><NoteText text={body} /></div>
		{#if rationale || hasVerdicts}
			<div class="rationale">
				{#if rationale}<NoteText text={rationale} />{/if}
				{#if hasVerdicts}<div class="verdicts"><Verdicts {...notes} speculative={notes ? speculative : undefined} {onPr} {setAside} /></div>{/if}
			</div>
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
	<div class="decide"><KeepSkip {kept} {suggested} {onkeep} {onskip} /></div>
	{#if onshow}
		<div class="foot"><button class="link" onclick={onshow}>{showLabel}</button></div>
	{/if}
</li>


<style>
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto 1fr;
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
	/* Under Keep and Skip, level with the bottom of the text beside it. */
	.text {
		grid-row: 1 / span 2;
	}
	.foot {
		grid-column: 2;
		grid-row: 2;
		align-self: end;
		display: flex;
		justify-content: flex-end;
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
	.verdicts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 2px;
	}
	.rationale {
		margin-top: 10px;
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
		grid-row: 1;
		grid-column: 2;
	}
</style>
