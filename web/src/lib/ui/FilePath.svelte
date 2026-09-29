<script lang="ts">
	// A file's path the way GitHub shows it: the folders dim, the name bright.
	// A long path loses its outer folders first, keeping the ones nearest the
	// file; the whole of it is on hover.
	let { path, lines }: { path: string; lines?: string } = $props();
	const cut = $derived(path.lastIndexOf('/'));
</script>

<span class="file-path" title={path}>
	{#if cut >= 0}<span class="dir"><span dir="ltr">{path.slice(0, cut + 1)}</span></span>{/if}<span class="base"
		>{path.slice(cut + 1)}</span
	>{#if lines}<span class="lines">&nbsp;· {lines}</span>{/if}
</span>

<style>
	.file-path {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		white-space: nowrap;
	}
	.dir {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		direction: rtl;
		opacity: 0.55;
	}
	.base,
	.lines {
		flex-shrink: 0;
	}
	.lines {
		opacity: 0.55;
	}
</style>
