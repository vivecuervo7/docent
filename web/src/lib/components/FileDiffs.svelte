<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { marksFrom } from '$lib/api';
	import { useSession } from '$lib/session.svelte';
	import type { FileNote } from '$lib/types';
	import DiffFile from './DiffFile.svelte';

	// Files as they're read: each with the hunks shown here, its note, its
	// pins, and a Reviewed control covering just those hunks.
	let {
		keys,
		notes = [],
		fold = null,
		anyOpen = $bindable(false)
	}: {
		// The hunks to show, as `path#index`, in the PR's file order.
		keys: string[];
		notes?: FileNote[];
		fold?: { open: boolean; at: number } | null;
		// Whether any file here is open, for the page's fold-all button.
		anyOpen?: boolean;
	} = $props();

	const open = new SvelteSet<string>();
	$effect(() => {
		anyOpen = open.size > 0;
	});

	const session = useSession();

	// Tests sort just after the file they test: "src/a.test.ts" and
	// "src/__tests__/a.ts" both sit beneath "src/a.ts".
	function fileOrder(path: string): string {
		const isTest = /\.(test|spec)\.[^/]+$/.test(path) || /(^|\/)(__tests__|tests?)\//.test(path);
		const subject = path.replace(/(^|\/)(__tests__|tests?)\//, '$1').replace(/\.(test|spec)(\.[^/.]+)$/, '$2');
		return `${subject}\u0000${isTest ? 1 : 0}`;
	}
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
			.sort((a, b) => fileOrder(a.filename).localeCompare(fileOrder(b.filename)))
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
