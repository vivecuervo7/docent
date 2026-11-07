<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { githubMarksFrom, marksFrom } from './marks';
	import { fileTree, treeOrder } from './fileTree';
	import { useSession } from '#lib/session/session.svelte.js';
	import type { FileNote } from '#lib/types.js';
	import DiffFile from './DiffFile.svelte';

	// Files as they're read: each with the hunks shown here, its note, its
	// pins, and a Reviewed control covering just those hunks.
	let {
		keys,
		notes = [],
		fold = null,
		allOpen = $bindable(false)
	}: {
		// The hunks to show, as `path#index`, in the PR's file order.
		keys: string[];
		notes?: FileNote[];
		fold?: { open: boolean; at: number } | null;
		// Whether every file here is open, for the page's fold-all button.
		allOpen?: boolean;
	} = $props();

	const open = new SvelteSet<string>();
	$effect(() => {
		allOpen = files.length > 0 && files.every(({ file }) => open.has(file.filename));
	});

	const session = useSession();

	const marks = $derived([...marksFrom(session.record, true), ...githubMarksFrom(session.githubInReading, session.record)]);

	const files = $derived.by(() => {
		const byFile = new Map<string, number[]>();
		for (const key of keys) {
			const at = key.lastIndexOf('#');
			const path = key.slice(0, at);
			byFile.set(path, [...(byFile.get(path) ?? []), Number(key.slice(at + 1))]);
		}
		// In the order the file tree shows them, so the two always match.
		const order = new Map(treeOrder(fileTree([...byFile.keys()])).map((path, i) => [path, i]));
		return session.files
			.filter((f) => byFile.has(f.filename))
			.sort((a, b) => order.get(a.filename)! - order.get(b.filename)!)
			.map((file) => {
				const indices = byFile.get(file.filename)!;
				const fileKeys = indices.map((i) => `${file.filename}#${i}`);
				return { file, indices, fileKeys };
			});
	});
</script>

<div class="files">
	{#each files as { file, indices, fileKeys } (file.filename)}
		{@const reviewed = fileKeys.every((k) => session.reviewed[k])}
		<DiffFile
			{file}
			allHunks={session.hunks.get(file.filename) ?? []}
			hunkIndices={indices}
			marks={marks.filter((m) => m.path === file.filename)}
			note={notes.find((n) => n.path === file.filename)}
			prRef={session.ref}
			whitespace={!session.hideWhitespace}
			{reviewed}
			onToggleReviewed={() => session.setReviewed(fileKeys, !reviewed)}
			{fold}
			foldTests={session.foldTests}
			showRemoved={session.commitView}
			onopenchange={(isOpen) => (isOpen ? open.add(file.filename) : open.delete(file.filename))}
		/>
	{/each}
</div>

<style>
	.files {
		display: flex;
		flex-direction: column;
	}
</style>
