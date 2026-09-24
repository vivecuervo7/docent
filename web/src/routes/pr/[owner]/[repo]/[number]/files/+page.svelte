<script lang="ts">
	import FileDiffs from '$lib/components/FileDiffs.svelte';
	import FoldAll from '$lib/components/FoldAll.svelte';
	import SliceRail from '$lib/components/SliceRail.svelte';
	import ViewOptions from '$lib/components/ViewOptions.svelte';
	import { useSession } from '$lib/session.svelte';

	// Every file in the PR, whole, outside the slices.
	const session = useSession();
	// The last expand all / collapse all, which every file follows.
	let fold = $state<{ open: boolean; at: number } | null>(null);
	const reviewedFiles = $derived(
		[...session.hunks].filter(([path, hunks]) => hunks.length && hunks.every((h) => session.reviewed[`${path}#${h.index}`])).length
	);
	// Every file's notes, whichever slice they were written for.
	const notes = $derived(Object.values(session.record.fileNotes ?? {}).flat());
</script>

<div class="page">
	<SliceRail allFiles />
	<main>
		<div class="top">
			<span class="label">All files</span>
			<span class="grow"></span>
			<ViewOptions />
		</div>
		<h1>All {session.files.length} files</h1>
		<div class="above-files">
			<p class="faint">{reviewedFiles} of {session.files.length} reviewed</p>
			<FoldAll onfold={(open) => (fold = { open, at: Date.now() })} />
		</div>
		<FileDiffs keys={session.hunkKeys} {notes} {fold} />
	</main>
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
		padding: 36px 56px 80px;
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
	h1 {
		margin: 10px 0 6px;
		font-family: var(--serif);
		font-size: 32px;
		font-weight: 500;
	}
	.above-files {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	p {
		margin: 0;
		font-size: 14px;
	}
</style>
