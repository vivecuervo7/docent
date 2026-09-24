<script lang="ts">
	import { page } from '$app/state';
	import { marksFrom } from '$lib/api';
	import DiffFile from '$lib/components/DiffFile.svelte';
	import StateMark from '$lib/components/StateMark.svelte';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';

	const session = useSession();
	const sliceId = $derived(page.params.slice);
	const slices = $derived(session.slices);
	const index = $derived(slices.findIndex((s) => s.id === sliceId));
	const slice = $derived(slices[index]);
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	const marks = $derived(marksFrom(session.record));

	// The slice's files, each with the hunks it covers, in the PR's order.
	const files = $derived.by(() => {
		const byFile = new Map<string, number[]>();
		for (const ref of slice?.hunks ?? []) {
			const at = ref.lastIndexOf('#');
			const path = ref.slice(0, at);
			byFile.set(path, [...(byFile.get(path) ?? []), Number(ref.slice(at + 1))]);
		}
		return session.files.filter((f) => byFile.has(f.filename)).map((file) => ({ file, hunks: byFile.get(file.filename)! }));
	});
</script>

<div class="page">
	<nav aria-label="Slices">
		<span class="label">Slices</span>
		<ol>
			{#each slices as s (s.id)}
				<li>
					<a href="{base}/slices/{s.id}" class:current={s.id === sliceId} aria-current={s.id === sliceId ? 'page' : undefined}>
						<span class="mark"><StateMark state={isSliceReviewed(s, session.record.reviewed) ? 'done' : s.id === sliceId ? 'now' : 'todo'} /></span>
						<span class="title">{s.title}</span>
					</a>
				</li>
			{/each}
		</ol>
	</nav>

	{#if slice}
		<main>
			<div class="top">
				<span class="label">Slice {index + 1} of {slices.length}</span>
				<span class="grow"></span>
				{#if index > 0}<a class="btn" href="{base}/slices/{slices[index - 1].id}">← Prev</a>{/if}
				{#if index < slices.length - 1}<a class="btn" href="{base}/slices/{slices[index + 1].id}">Next →</a>{/if}
			</div>
			<h1>{slice.title}</h1>
			<p class="summary">{slice.summary}</p>
			<p class="hint faint">Drag down the line numbers to select lines.</p>
			<div class="files">
				{#each files as { file, hunks } (file.filename)}
					<DiffFile
						{file}
						hunkIndices={hunks}
						marks={marks.filter((m) => m.path === file.filename)}
						note={session.record.fileNotes?.[slice.id]?.find((n) => n.path === file.filename)}
					/>
				{/each}
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
	nav {
		position: sticky;
		top: 64px;
		align-self: start;
		height: calc(100vh - 64px);
		box-sizing: border-box;
		padding: 28px 16px;
		border-right: 1px solid var(--line);
		overflow-y: auto;
	}
	.label {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	nav .label {
		padding: 0 12px;
	}
	nav ol {
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	nav a {
		display: flex;
		gap: 12px;
		padding: 9px 12px;
		border-radius: 10px;
		text-decoration: none;
		color: var(--muted);
		font-size: 14px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	nav a:hover {
		color: var(--text);
	}
	nav a.current {
		background: var(--surface-2);
		color: var(--text);
		font-weight: 500;
	}
	.mark {
		padding-top: 1px;
	}
	main {
		padding: 36px 56px 120px;
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
	.hint {
		margin: 0 0 20px;
		font-size: 13px;
	}
	.files {
		display: flex;
		flex-direction: column;
	}
</style>
