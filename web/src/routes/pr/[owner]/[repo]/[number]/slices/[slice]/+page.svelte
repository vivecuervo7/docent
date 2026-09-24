<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Mark } from '$lib/api';
	import Dialog from '$lib/components/Dialog.svelte';
	import FileDiffs from '$lib/components/FileDiffs.svelte';
	import FindingCard from '$lib/components/FindingCard.svelte';
	import FindingLines from '$lib/components/FindingLines.svelte';
	import FoldAll from '$lib/components/FoldAll.svelte';
	import SliceRail from '$lib/components/SliceRail.svelte';
	import ViewOptions from '$lib/components/ViewOptions.svelte';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';

	const session = useSession();
	let anyOpen = $state(false);
	// The last expand all / collapse all on this slice, which its files follow.
	let fold = $state<{ open: boolean; at: number; slice: string } | null>(null);
	const sliceId = $derived(page.params.slice);
	const slices = $derived(session.slices);
	const index = $derived(slices.findIndex((s) => s.id === sliceId));
	const slice = $derived(slices[index]);
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	const done = $derived(slice ? isSliceReviewed(slice, session.reviewed) : false);

	// Files in this slice, and how many are reviewed.
	const fileCounts = $derived.by(() => {
		const byFile = new Map<string, boolean>();
		for (const key of slice?.hunks ?? []) {
			const path = key.slice(0, key.lastIndexOf('#'));
			byFile.set(path, (byFile.get(path) ?? true) && !!session.reviewed[key]);
		}
		return { total: byFile.size, reviewed: [...byFile.values()].filter(Boolean).length };
	});

	// The next slice still to review, after this one, else before it.
	const next = $derived.by(() => {
		const after = slices.slice(index + 1).find((s) => !isSliceReviewed(s, session.reviewed));
		return after ?? slices.slice(0, index).find((s) => !isSliceReviewed(s, session.reviewed));
	});

	function goNext() {
		goto(next ? `${base}/slices/${next.id}` : base);
	}

	const markById = (id: string): Mark | undefined => session.findings.find((f) => f.mark.id === id)?.mark;

	function go(target: string | null) {
		goto(target ? `${base}/slices/${target}` : base);
		window.scrollTo(0, 0);
	}

	// A second opinion: marking a slice reviewed shows the panel's findings on
	// it that are still waiting on a keep or skip, before moving on.
	let opinion = $state<{ ids: string[]; next: string | null } | null>(null);

	async function markReviewed() {
		if (!slice) return;
		const target = next?.id ?? null;
		const pending = session.undecidedIn(slice.id).map((m) => m.id);
		await session.setReviewed(slice.hunks, true);
		if (pending.length) opinion = { ids: pending, next: target };
		else go(target);
	}

	// Findings that landed on slices already reviewed, elsewhere in the PR.
	const lateElsewhere = $derived(
		session.late.filter(
			(m) => !session.lateLeft.has(m.id) && !session.findings.find((f) => f.mark.id === m.id)?.slices.includes(sliceId ?? "")
		)
	);
	// Catching up on them one at a time, with their lines.
	let catchUp = $state<{ ids: string[]; at: number } | null>(null);
	const catching = $derived(catchUp ? markById(catchUp.ids[catchUp.at]) : undefined);

	function decide(included: boolean) {
		if (!catchUp || !catching?.reviewer) return;
		session.setFindingIncluded(catching.reviewer, catching.id, included);
		advance();
	}

	function advance() {
		if (!catchUp) return;
		catchUp = catchUp.at + 1 < catchUp.ids.length ? { ...catchUp, at: catchUp.at + 1 } : null;
	}

	// Opens a finding where it sits in the diff: its file, then its pin.
	function reveal(mark: Mark) {
		const section = document.querySelector<HTMLElement>(`section.file[data-path="${CSS.escape(mark.path)}"]`);
		const toggle = section?.querySelector<HTMLButtonElement>('.toggle[aria-expanded="false"]');
		toggle?.click();
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const pin = section?.querySelector<HTMLElement>(`[data-pin="${mark.id}"]`);
				(pin ?? section)?.scrollIntoView({ block: 'center' });
				pin?.click();
			})
		);
	}

	// Arriving from Catch up's "Show in diff" opens the finding it named.
	$effect(() => {
		const id = page.url.searchParams.get('finding');
		const mark = id ? markById(id) : undefined;
		if (mark && session.files.length) setTimeout(() => reveal(mark), 300);
	});

	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, select, [contenteditable]')) return;
		if (catchUp && (e.key === 'k' || e.key === 's')) {
			e.preventDefault();
			decide(e.key === 'k');
			return;
		}
		if (opinion || catchUp) return;
		if (e.key === 'r' && !done) {
			e.preventDefault();
			markReviewed();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
	<SliceRail current={sliceId} />

	{#if slice}
		<main>
			<div class="top">
				<span class="label">Slice {index + 1} of {slices.length}</span>
				<span class="grow"></span>
				<ViewOptions />
				{#if index > 0}<a class="btn" href="{base}/slices/{slices[index - 1].id}">← Prev</a>{/if}
				{#if index < slices.length - 1}<a class="btn" href="{base}/slices/{slices[index + 1].id}">Next →</a>{/if}
			</div>
			{#if lateElsewhere.length}
				<div class="late" role="status">
					<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .6 11.4 6 6 11.4.6 6Z" fill="var(--agent)" /></svg>
					<span class="grow">
						{lateElsewhere.length} {lateElsewhere.length === 1 ? 'finding' : 'findings'} landed on slices you’ve already reviewed
					</span>
					<button class="btn" onclick={() => lateElsewhere.forEach((m) => session.lateLeft.add(m.id))}>Later</button>
					<button class="btn primary" onclick={() => (catchUp = { ids: lateElsewhere.map((m) => m.id), at: 0 })}>Catch up</button>
				</div>
			{/if}
			<h1>{slice.title}</h1>
			<p class="summary">{slice.summary}</p>
			{#key slice.id}
				<div class="above-files">
					<p class="hint faint">Drag down the line numbers to select lines.</p>
					<FoldAll {anyOpen} onfold={(open) => (fold = { open, at: Date.now(), slice: slice.id })} />
				</div>
				<FileDiffs bind:anyOpen keys={slice.hunks} notes={session.record.fileNotes?.[slice.id] ?? []} fold={fold?.slice === slice.id ? fold : null} />
			{/key}

			<div class="finish">
				<span class="faint">{fileCounts.reviewed} of {fileCounts.total} {fileCounts.total === 1 ? 'file' : 'files'} reviewed</span>
				{#if done}
					<button class="btn" onclick={() => session.setReviewed(slice.hunks, false)}>Mark not reviewed</button>
					<button class="btn primary big" onclick={goNext}>{next ? 'Next slice →' : 'Back to the Overview'}</button>
				{:else}
					<button class="btn primary big" onclick={markReviewed}>Mark slice reviewed <kbd>R</kbd></button>
				{/if}
			</div>
		</main>
	{:else}
		<main><p>No slice “{sliceId}” in this PR.</p></main>
	{/if}
</div>

{#if opinion}
	{@const marks = opinion.ids.map(markById).filter((m) => m !== undefined)}
	<Dialog label="Slice reviewed" onclose={() => go(opinion?.next ?? null)}>
		<span class="done-label">Slice reviewed</span>
		<h2>The panel noticed {marks.length} {marks.length === 1 ? 'thing' : 'things'} here</h2>
		{#each marks as mark (mark.id)}
			<FindingCard
				{mark}
				onshow={() => {
					opinion = null;
					reveal(mark);
				}}
			/>
		{/each}
		<div class="dialog-foot">
			<span class="faint">{marks.filter((m) => !m.decided).length ? 'Undecided ones wait for you in Wrap up.' : ''}</span>
			<button class="btn primary big" onclick={() => go(opinion?.next ?? null)}>{opinion.next ? 'Next slice →' : 'Back to the Overview'}</button>
		</div>
	</Dialog>
{/if}

{#if catchUp && catching}
	{@const where = session.findings.find((f) => f.mark.id === catching.id)?.slices[0]}
	<Dialog label="Catch up" onclose={() => (catchUp = null)}>
		<span class="done-label">Catching up · {catchUp.at + 1} of {catchUp.ids.length}</span>
		<FindingLines mark={catching} />
		{#key catching.id}
			<FindingCard
				mark={catching}
				onshow={() => {
					const id = catching.id;
					catchUp = null;
					goto(`${base}/slices/${where}?finding=${id}`);
				}}
			/>
		{/key}
		<div class="dialog-foot">
			<span class="faint">K to keep · S to skip</span>
			<button class="btn big" onclick={advance}>{catchUp.at + 1 < catchUp.ids.length ? 'Next' : 'Done'}</button>
		</div>
	</Dialog>
{/if}

<style>
	.page {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		min-height: calc(100vh - 64px);
	}
	.label {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	main {
		padding: 36px 56px 40px;
		max-width: 1180px;
		box-sizing: border-box;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.grow {
		flex-grow: 1;
	}
	.top .btn {
		text-decoration: none;
	}
	h1 {
		margin: 10px 0 10px;
		font-family: var(--serif);
		font-size: 32px;
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}
	.late {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 14px 0 4px;
		padding: 10px 10px 10px 16px;
		border-radius: 12px;
		background: var(--popover);
		box-shadow: 0 0 0 1px var(--popover-line);
		font-size: 14px;
	}
	.done-label {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--done);
	}
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
		line-height: 1.2;
	}
	.dialog-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-top: 4px;
		font-size: 13px;
	}
	.summary {
		margin: 0 0 8px;
		max-width: 860px;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.6;
	}
	.above-files {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.hint {
		margin: 0;
		font-size: 13px;
	}
	.finish {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 12px;
		padding: 16px 0 24px;
		background: linear-gradient(transparent, var(--bg) 30%);
		font-size: 13.5px;
		/* Clicks reach the code under the fade; only the bar's own controls take them. */
		pointer-events: none;
	}
	.finish > * {
		pointer-events: auto;
	}
	.big {
		height: 42px;
		padding: 0 18px;
		border-radius: 12px;
		font-size: 14.5px;
	}
	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		padding: 0 5px;
		border-radius: 5px;
		background: #d8d3c7;
		color: #141413;
		font-family: var(--mono);
		font-size: 11.5px;
	}
</style>
