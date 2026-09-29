<script lang="ts">
	import FilePath from '$lib/ui/FilePath.svelte';
	import Floating from '$lib/ui/Floating.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import StateMark from '$lib/ui/StateMark.svelte';
	import MarkPopover from '../panel/MarkPopover.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import type { FileNote, PrFile } from '$lib/types';
	import type { LooseMark, Mark } from './marks';
	import Pin from './Pin.svelte';

	// A file's header in the diff: opening and closing it, its path, what its
	// note says while it's closed, its changes, the slices holding the rest of
	// it, its marker, and marking it reviewed.
	let {
		file,
		note,
		collapsed = $bindable(),
		counts,
		elsewhere,
		summary,
		wholeFile,
		openAnchor,
		reviewed,
		onreview
	}: {
		file: PrFile;
		note?: FileNote;
		collapsed: boolean;
		counts: { added: number; removed: number };
		// The other slices holding the rest of the file, numbered as they're shown.
		elsewhere: { id: string; n: number }[];
		// A closed file's one marker; see DiffFile.
		summary: { kind: 'finding' | 'note'; first: Mark | { id: string }; solid: boolean; unread: boolean; count: number } | null;
		// Findings about the file as a whole, with no lines to sit on.
		wholeFile: LooseMark[];
		openAnchor: HTMLElement | null;
		reviewed: boolean;
		onreview?: () => void;
	} = $props();

	const session = useSession();
</script>

<header>
	<button class="toggle" aria-expanded={!collapsed} title={file.filename} onclick={() => (collapsed = !collapsed)}>
		<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={collapsed ? '' : 'rotate(90deg)'}><path d="M9 6l6 6-6 6" /></svg>
		<span class="path"><FilePath path={file.filename} /></span>
		<span class="gist faint">{#if note?.note && collapsed}<InlineText text={`${note.kind === 'tests' ? 'Tests · ' : ''}${note.note.replace(/^- /, '').split('\n')[0]}`} />{/if}</span>
		<span class="stat"><span class="plus">+{counts.added}</span> <span class="minus">−{counts.removed}</span></span>
	</button>
	{#if elsewhere.length}
		<span class="rest faint"
			>rest in {elsewhere.length === 1 ? 'slice' : 'slices'}
			{#each elsewhere as e, i (e.id)}{i ? ', ' : ''}<a href="/pr/{session.ref.owner}/{session.ref.repo}/{session.ref.number}/slices/{e.id}">{e.n}</a
				>{/each}</span
		>
	{/if}
	{#if collapsed ? summary : wholeFile.length}
		<!-- A closed file shows one marker while findings await confirming or
		     anything is new to read; an open one shows the findings about the
		     whole file, which have no lines to sit on. -->
		<span class="pins">
			{#if collapsed && summary}
				{@const label = summary.count
					? `${summary.count} ${summary.count === 1 ? 'finding' : 'findings'} to confirm`
					: summary.kind === 'finding'
						? 'New to read on a finding'
						: 'New reply in a thread'}
				{@const first = summary.first}
				<Pin
					kind={summary.kind}
					skipped={!summary.solid}
					unread={summary.unread}
					label="{label} - open {summary.count ? 'the first' : 'it'}"
					title={label}
					onclick={() => (session.revealing = first.id)}
				/>
			{:else if !collapsed}
				{#each wholeFile as m (m.id)}
					<Pin
						kind="finding"
						id={m.id}
						skipped={m.included === false}
						active={session.openMark === m.id}
						unread={m.unread}
						unreadLabel="New answer"
						label="Finding about the whole file, from {m.who}"
						title="A finding about the whole file, from {m.who}"
						onclick={() => (session.openMark = session.openMark === m.id ? null : m.id)}
					/>
				{/each}
			{/if}
		</span>
	{/if}
	<!-- Outside the pins, whose transform would trap the bubble under the diff. -->
	{#each wholeFile as m (m.id)}
		{#if session.openMark === m.id}
			<Floating anchor={openAnchor} label="Finding" tone="agent">
				<MarkPopover mark={m} onclose={() => (session.openMark = null)} />
			</Floating>
		{/if}
	{/each}
	{#if onreview}
		<button class="review" class:done={reviewed} aria-pressed={reviewed} onclick={onreview}>
			<StateMark state={reviewed ? 'done' : 'todo'} size={15} />
			{reviewed ? 'Reviewed' : 'Mark reviewed'}
		</button>
	{/if}
</header>

<style>
	header {
		position: relative;
		display: flex;
		align-items: center;
		height: 52px;
	}
	.toggle {
		flex-grow: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 4px 0 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 13.5px;
		text-align: left;
		cursor: pointer;
	}
	.chevron {
		flex-shrink: 0;
		color: var(--faint);
	}
	.toggle:hover .chevron,
	.toggle:hover .path {
		color: #fff;
	}
	.path {
		display: flex;
		min-width: 0;
		flex-shrink: 1;
		font-family: var(--mono);
		color: var(--text);
		white-space: nowrap;
	}
	.gist {
		flex-grow: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat {
		font-family: var(--mono);
		font-size: 12px;
		white-space: nowrap;
	}
	.plus {
		color: var(--plus-dull);
	}
	.minus {
		color: var(--minus-dull);
	}
	.rest {
		flex-shrink: 0;
		margin-left: 6px;
		padding-right: 12px;
		font-size: 12.5px;
		white-space: nowrap;
	}
	.rest a {
		color: inherit;
		text-underline-offset: 3px;
	}
	.rest a:hover {
		color: var(--text);
	}
	/* Hangs off the header's right edge, in line with the pins beside the code. */
	.pins {
		position: absolute;
		left: calc(100% + 8px);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		gap: 4px;
	}
	.review {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex-shrink: 0;
		height: 30px;
		margin-left: 14px;
		padding: 0 11px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.review.done {
		color: var(--faint);
	}
	.review:hover {
		background: rgba(255, 255, 255, 0.04);
	}
</style>
