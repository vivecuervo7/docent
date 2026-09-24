<script lang="ts">
	import { marksFrom } from '$lib/api';
	import DiffFile from '$lib/components/DiffFile.svelte';

	let { data } = $props();

	const slices = $derived(data.record.slices ?? []);
	const index = $derived(slices.findIndex((s) => s.id === data.slice));
	const slice = $derived(slices[index]);
	const base = $derived(`/pr/${data.owner}/${data.repo}/${data.number}`);
	const marks = $derived(marksFrom(data.record));

	// The slice's files, each with the hunks it covers, in the PR's order.
	const files = $derived.by(() => {
		const byFile = new Map<string, number[]>();
		for (const ref of slice?.hunks ?? []) {
			const at = ref.lastIndexOf('#');
			const path = ref.slice(0, at);
			byFile.set(path, [...(byFile.get(path) ?? []), Number(ref.slice(at + 1))]);
		}
		return data.files.filter((f) => byFile.has(f.filename)).map((file) => ({ file, hunks: byFile.get(file.filename)! }));
	});
</script>

<svelte:head><title>{slice?.title ?? 'Slice'} · Docent</title></svelte:head>

<div class="page">
	<nav aria-label="Slices">
		<span class="label">Slices</span>
		<ol>
			{#each slices as s, i (s.id)}
				<li>
					<a href="{base}/slices/{s.id}" class:current={s.id === data.slice} aria-current={s.id === data.slice ? 'page' : undefined}>
						<span class="num">{i + 1}</span>
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
						note={data.record.fileNotes?.[slice.id]?.find((n) => n.path === file.filename)}
					/>
				{/each}
			</div>
		</main>
	{:else}
		<main><p>No slice “{data.slice}” in this PR.</p></main>
	{/if}
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		min-height: 100vh;
	}
	nav {
		position: sticky;
		top: 0;
		align-self: start;
		height: 100vh;
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
	.num {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		padding-top: 2px;
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
		gap: 22px;
	}
</style>
