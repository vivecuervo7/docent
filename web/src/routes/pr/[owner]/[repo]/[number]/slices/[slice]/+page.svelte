<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import FileDiffs from '$lib/components/FileDiffs.svelte';
	import FoldAll from '$lib/components/FoldAll.svelte';
	import SliceRail from '$lib/components/SliceRail.svelte';
	import ViewOptions from '$lib/components/ViewOptions.svelte';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';

	const session = useSession();
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

	async function markReviewed() {
		if (!slice) return;
		const target = next;
		await session.setReviewed(slice.hunks, true);
		goto(target ? `${base}/slices/${target.id}` : base);
		window.scrollTo(0, 0);
	}

	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, select, [contenteditable]')) return;
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
			<h1>{slice.title}</h1>
			<p class="summary">{slice.summary}</p>
			{#key slice.id}
				<div class="above-files">
					<p class="hint faint">Drag down the line numbers to select lines.</p>
					<FoldAll onfold={(open) => (fold = { open, at: Date.now(), slice: slice.id })} />
				</div>
				<FileDiffs keys={slice.hunks} notes={session.record.fileNotes?.[slice.id] ?? []} fold={fold?.slice === slice.id ? fold : null} />
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
