<script lang="ts">
	import InlineText from './InlineText.svelte';

	// A file note's text: paragraphs, and "- " lines as a list.
	let { text }: { text: string } = $props();

	const blocks = $derived.by(() => {
		const out: ({ list: false; text: string } | { list: true; items: string[] })[] = [];
		for (const raw of text.split('\n')) {
			const line = raw.trim();
			if (!line) continue;
			const item = line.match(/^[-*]\s+(.*)$/);
			const last = out.at(-1);
			if (item) {
				if (last?.list) last.items.push(item[1]);
				else out.push({ list: true, items: [item[1]] });
			} else out.push({ list: false, text: line });
		}
		return out;
	});
</script>

{#each blocks as block, i (i)}
	{#if block.list}
		<ul>
			{#each block.items as item, j (j)}<li><InlineText text={item} /></li>{/each}
		</ul>
	{:else}
		<p><InlineText text={block.text} /></p>
	{/if}
{/each}

<style>
	p,
	ul {
		margin: 0;
	}
	ul {
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
</style>
