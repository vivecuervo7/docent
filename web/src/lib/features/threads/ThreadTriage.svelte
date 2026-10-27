<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import InlineText from '$lib/ui/InlineText.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import type { GitHubThread } from '$lib/types';
	import ThreadDialog from './ThreadDialog.svelte';
	import type { PrThreads } from './prThreads.svelte';
	import { VERDICTS, checkOf, gist, isStale, threadWhere, type Verdict } from './threads';
	import VerdictLabel from './VerdictLabel.svelte';

	// A PR's GitHub threads, gone through: all checked at once for whether
	// they've been dealt with, those that look addressed resolved together,
	// and any opened to look closer. On a review's Overview, `base` is its
	// page, which a thread can be opened on by URL.
	let { threads: source, base }: { threads: PrThreads; base?: string } = $props();

	// By file, then line.
	const all = $derived([...source.threads].sort((a, b) => a.path.localeCompare(b.path) || (a.start?.line ?? 0) - (b.start?.line ?? 0)));
	const open = $derived(all.filter((t) => !t.resolved));
	const resolved = $derived(all.filter((t) => t.resolved));
	let showResolved = $state(false);

	const checks = $derived(source.checks);
	const stale = (t: GitHubThread) => isStale(check(t), source.head);
	const check = (t: GitHubThread) => checkOf(checks, t);
	const checking = $derived(open.filter((t) => check(t)?.checking));
	const unchecked = $derived(open.filter((t) => !check(t)));
	const byVerdict = (v: Verdict) => open.filter((t) => check(t)?.verdict === v);
	const anyChecked = $derived(open.some((t) => check(t)?.verdict));
	// What's still to look at, when some are checked: new since, failed, or under way.
	const rest = $derived(open.filter((t) => !check(t)?.verdict));

	// Those that look addressed are ticked to resolve, unless unticked.
	const unticked = new SvelteSet<string>();
	const ticked = $derived(byVerdict('addressed').filter((t) => !unticked.has(t.id)));
	function toggle(id: string) {
		if (unticked.has(id)) unticked.delete(id);
		else unticked.add(id);
	}

	let error = $state<string | null>(null);
	let resolving = $state(false);
	async function resolveTicked() {
		resolving = true;
		error = null;
		try {
			await source.change(ticked.map((thread) => ({ thread, resolved: true })));
		} catch (err) {
			error = (err as Error).message;
		} finally {
			resolving = false;
		}
	}

	async function checkAll(threads: GitHubThread[]) {
		error = null;
		try {
			await source.check(threads);
		} catch (err) {
			error = (err as Error).message;
		}
	}

	// The thread open for a closer look, and the threads it steps through, in
	// the order they were listed when it opened. Opened from the diff, by URL.
	let opened = $state<{ id: string; order: string[] } | null>(null);
	const listed = $derived([...(anyChecked ? [...VERDICTS.flatMap(({ verdict }) => byVerdict(verdict)), ...rest] : open), ...(showResolved ? resolved : [])]);
	function show(id: string) {
		opened = { id, order: listed.some((t) => t.id === id) ? listed.map((t) => t.id) : [id] };
	}
	$effect(() => {
		const id = base && page.url.searchParams.get('thread');
		if (base && id && all.some((t) => t.id === id) && opened?.id !== id) {
			show(id);
			goto(base, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});
</script>

{#snippet row(t: GitHubThread, tick: boolean)}
	{@const c = check(t)}
	<li>
		{#if tick}
			<input type="checkbox" checked={!unticked.has(t.id)} aria-label="Resolve {threadWhere(t)}" onchange={() => toggle(t.id)} />
		{/if}
		<button class="open" onclick={() => show(t.id)}>
			<span class="meta">
				<span class="mono">{threadWhere(t)}</span> · {t.entries[0]?.author ?? 'someone'}
				{#if t.entries.length > 1}· {t.entries.length - 1} {t.entries.length === 2 ? 'reply' : 'replies'}{/if}
				{#if t.outdated}· outdated{/if}
			</span>
			<span class="gist"><InlineText text={gist(t)} /></span>
			{#if c?.checking}
				<span class="reason faint"><Spinner size={12} /> Checking…</span>
			{:else if c?.error}
				<span class="reason bad">Couldn’t check: {c.error}</span>
			{:else if c?.reason}
				<span class="reason"><span><InlineText text={c.reason} /></span></span>
				{#if stale(t)}<span class="reason faint">Checked before the latest commits</span>{/if}
			{:else if checks?.[t.id] && !t.resolved}
				<span class="reason faint">New replies since it was checked</span>
			{/if}
		</button>
	</li>
{/snippet}

<section class="triage">
	<div class="head">
		<h2>GitHub threads</h2>
		<span class="grow"></span>
		{#if source.data && open.length}
			{#if checking.length}
				<span class="checking faint"
					><Spinner size={12} /> Checking {checking.length < open.length ? `${checking.length} of ${open.length}` : `all ${open.length}`}…</span
				>
			{:else if anyChecked}
				{#if unchecked.length}
					<button class="link" onclick={() => checkAll(unchecked)}>Check {unchecked.length} new</button>
				{/if}
				<button class="link" onclick={() => checkAll(open)}>Check again</button>
			{:else}
				<button class="link" title="Whether each has been dealt with since it was left, one line each" onclick={() => checkAll(open)}>Check them</button>
			{/if}
		{/if}
		{#if ticked.length}
			<button class="btn primary" disabled={resolving} onclick={resolveTicked}>
				{#if resolving}<Spinner size={13} />{/if} Resolve {ticked.length} selected
			</button>
		{/if}
	</div>

	{#if source.error && !source.data}
		<p class="bad">Couldn’t read the threads: {source.error}</p>
	{:else if !source.data}
		<p class="faint">Reading what’s been said on GitHub…</p>
	{:else if !all.length}
		<p class="faint">No threads on GitHub yet.</p>
	{:else}
		{#if error}<p class="bad">{error}</p>{/if}

		{#if anyChecked}
			{#each VERDICTS as { verdict, label } (verdict)}
				{@const threads = byVerdict(verdict)}
				{#if threads.length}
					<div class="group">
						<VerdictLabel {verdict} size={13.5}>{label} · {threads.length}</VerdictLabel>
						<ul>
							{#each threads as t (t.id)}{@render row(t, verdict === 'addressed')}{/each}
						</ul>
					</div>
				{/if}
			{/each}
			{#if rest.length}
				<div class="group">
					<VerdictLabel size={13.5}>Not checked · {rest.length}</VerdictLabel>
					<ul>
						{#each rest as t (t.id)}{@render row(t, false)}{/each}
					</ul>
				</div>
			{/if}
		{:else if open.length}
			<ul>
				{#each open as t (t.id)}{@render row(t, false)}{/each}
			</ul>
		{:else}
			<p class="faint">Every thread is resolved.</p>
		{/if}

		<!-- Resolved threads come last, and only on asking. -->
		{#if resolved.length}
			<button class="link more" aria-expanded={showResolved} onclick={() => (showResolved = !showResolved)}>
				{showResolved ? 'Hide' : 'Show'}
				{resolved.length} resolved
			</button>
			{#if showResolved}
				<ul>
					{#each resolved as t (t.id)}{@render row(t, false)}{/each}
				</ul>
			{/if}
		{/if}
		{#if open.length}<p class="faint small">Resolve, reopen and reply act on GitHub straight away.</p>{/if}
	{/if}
</section>

{#if opened}
	<ThreadDialog threads={source} bind:id={opened.id} order={opened.order} onclose={() => (opened = null)} />
{/if}

<style>
	.checking {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.triage {
		margin-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	/* As tall with Resolve as without, so unticking the last doesn't jump. */
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 34px;
		font-size: 13.5px;
	}
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 24px;
		font-weight: 500;
	}
	.grow {
		flex-grow: 1;
	}
	li input {
		accent-color: var(--you);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	li {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 0 0 0 14px;
		border-top: 1px solid var(--line);
	}
	li:first-child {
		border-top: 0;
	}
	li input {
		margin: 14px 0 0;
	}
	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 11px 14px 11px 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.open:hover .gist {
		color: #fff;
	}
	.meta {
		font-size: 12.5px;
		color: var(--faint);
	}
	.mono {
		font-family: var(--mono);
		font-size: 12px;
	}
	.gist {
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.reason {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--muted);
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.more {
		align-self: flex-start;
	}
	.link:hover {
		color: var(--text);
	}
	.bad {
		margin: 0;
		color: var(--danger);
	}
	p {
		margin: 0;
		font-size: 14px;
	}
	.small {
		font-size: 12.5px;
	}
</style>
