<script lang="ts">
	import { marksFrom } from '$lib/api';
	import { useSession } from '$lib/session.svelte';
	import type { FileNote } from '$lib/types';
	import DiffFile from './DiffFile.svelte';

	// Files as they're read: each with the hunks shown here, its note, its
	// pins, and a Reviewed control covering just those hunks.
	let {
		keys,
		notes = [],
		fold = null
	}: {
		// The hunks to show, as `path#index`, in the PR's file order.
		keys: string[];
		notes?: FileNote[];
		fold?: { open: boolean; at: number } | null;
	} = $props();

	const session = useSession();
	const marks = $derived(marksFrom(session.record));

	const files = $derived.by(() => {
		const byFile = new Map<string, number[]>();
		for (const key of keys) {
			const at = key.lastIndexOf('#');
			const path = key.slice(0, at);
			byFile.set(path, [...(byFile.get(path) ?? []), Number(key.slice(at + 1))]);
		}
		return session.files
			.filter((f) => byFile.has(f.filename))
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
			autoReviewed={reviewed && fileKeys.every((k) => session.autoReviewed.has(k))}
			onToggleReviewed={() => session.setReviewed(fileKeys, !reviewed)}
			{fold}
		/>
	{/each}
</div>

<style>
	.files {
		display: flex;
		flex-direction: column;
	}
</style>
