<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import InlineText from '$lib/ui/InlineText.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import type { GitHubThread } from '$lib/types';
	import ThreadDialog from './ThreadDialog.svelte';
	import { VERDICTS, checkOf, gist, threadWhere, touchedBy, type Verdict } from './threads';

	// The GitHub threads on the round, gone through before reading it: all
	// checked against the round at once, those that look addressed resolved
	// together, and any opened to look closer.
	const session = useSession();

	// Threads on lines the round changed first, as the ones it may have settled.
	const all = $derived.by(() => {
		const threads = session.githubShown?.threads ?? [];
		const order = new Map(session.files.map((f, i) => [f.filename, i]));
		return [...threads].sort(
			(a, b) =>
				Number(touchedBy(session.files, b)) - Number(touchedBy(session.files, a)) ||
				(order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity) ||
				(a.start?.line ?? 0) - (b.start?.line ?? 0)
		);
	});
	const open = $derived(all.filter((t) => !t.resolved));
	const resolved = $derived(all.filter((t) => t.resolved));
	let showResolved = $state(false);

	const checks = $derived(session.record.threadChecks);
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
			await session.changeThreads(ticked.map((thread) => ({ thread, resolved: true })));
		} catch (err) {
			error = (err as Error).message;
		} finally {
			resolving = false;
		}
	}

	async function checkAll(threads: GitHubThread[]) {
		error = null;
		try {
			await session.checkThreads(threads);
		} catch (err) {
			error = (err as Error).message;
		}
	}

	// The thread open for a closer look, and the threads it steps through, in
	// the order they were listed when it opened. Opened from the diff, by URL.
	let opened = $state<{ id: string; order: string[] } | null>(null);
	const listed = $derived([
		...(anyChecked ? [...VERDICTS.flatMap(({ verdict }) => byVerdict(verdict)), ...rest] : open),
		...(showResolved ? resolved : [])
	]);
	function show(id: string) {
		opened = { id, order: listed.some((t) => t.id === id) ? listed.map((t) => t.id) : [id] };
	}
	$effect(() => {
		const id = page.url.searchParams.get('thread');
		if (id && all.some((t) => t.id === id) && opened?.id !== id) {
			show(id);
			goto(session.base, { replaceState: true, noScroll: true, keepFocus: true });
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
				{#if t.outdated}· outdated{:else if touchedBy(session.files, t) && session.files.some((f) => f.rangeLines)}· changed this round{/if}
			</span>
			<span class="gist"><InlineText text={gist(t)} /></span>
			{#if c?.checking}
				<span class="reason faint"><Spinner size={12} /> Checking…</span>
			{:else if c?.error}
				<span class="reason bad">Couldn’t check: {c.error}</span>
			{:else if c?.reason}
				<span class="reason"><span><InlineText text={c.reason} /></span></span>
			{:else if checks?.[t.id] && !t.resolved}
				<span class="reason faint">New replies since it was checked</span>
			{/if}
		</button>
	</li>
{/snippet}

<section class="triage">
	<div class="head">
		<h2>GitHub threads</h2>
		<span class="faint">{open.length} open{#if resolved.length}{` · ${resolved.length} resolved`}{/if}</span>
		<span class="grow"></span>
		{#if session.github && open.length}
			{#if checking.length}
				<span class="checking faint"><Spinner size={12} /> Checking {checking.length < open.length ? `${checking.length} of ${open.length}` : `all ${open.length}`}…</span>
			{:else if anyChecked}
				{#if unchecked.length}
					<button class="link" onclick={() => checkAll(unchecked)}>Check {unchecked.length} new</button>
				{/if}
				<button class="link" onclick={() => checkAll(open)}>Check again</button>
			{:else}
				<button class="link" title="Whether this round addresses them, one line each" onclick={() => checkAll(open)}>Check against this round</button>
			{/if}
		{/if}
		{#if resolved.length}
			<label class="toggle">
				<input type="checkbox" bind:checked={showResolved} />
				Show resolved
			</label>
		{/if}
	</div>

	{#if !session.github}
		<p class="faint">Reading what’s been said on GitHub…</p>
	{:else if !all.length}
		<p class="faint">No threads on this round’s files.</p>
	{:else}
		{#if error}<p class="bad">{error}</p>{/if}

		{#if anyChecked}
			{#each VERDICTS as { verdict, label } (verdict)}
				{@const threads = byVerdict(verdict)}
				{#if threads.length}
					<div class="group">
						<div class="group-head">
							<span class="verdict {verdict}">{label} · {threads.length}</span>
							{#if verdict === 'addressed'}
								<span class="grow"></span>
								<button class="btn primary" disabled={!ticked.length || resolving} onclick={resolveTicked}>
									{#if resolving}<Spinner size={13} />{/if} Resolve {ticked.length} selected
								</button>
							{/if}
						</div>
						<ul>{#each threads as t (t.id)}{@render row(t, verdict === 'addressed')}{/each}</ul>
					</div>
				{/if}
			{/each}
			{#if rest.length}
				<div class="group">
					<div class="group-head"><span class="verdict">Not checked · {rest.length}</span></div>
					<ul>{#each rest as t (t.id)}{@render row(t, false)}{/each}</ul>
				</div>
			{/if}
		{:else if open.length}
			<ul>{#each open as t (t.id)}{@render row(t, false)}{/each}</ul>
		{/if}

		{#if showResolved && resolved.length}
			<div class="group">
				<div class="group-head"><span class="verdict">Resolved · {resolved.length}</span></div>
				<ul>{#each resolved as t (t.id)}{@render row(t, false)}{/each}</ul>
			</div>
		{/if}
		<p class="faint small">Resolve, reopen and reply act on GitHub straight away.</p>
	{/if}
</section>

{#if opened}
	<ThreadDialog bind:id={opened.id} order={opened.order} onclose={() => (opened = null)} />
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
	.head,
	.group-head {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13.5px;
	}
	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.grow {
		flex-grow: 1;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--muted);
		font-size: 13px;
		cursor: pointer;
	}
	.toggle input,
	li input {
		accent-color: var(--you);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.verdict {
		font-weight: 600;
		color: var(--muted);
	}
	.verdict.addressed {
		color: var(--done);
	}
	.verdict.not-yet {
		color: var(--agent);
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
