<script lang="ts">
	// Prose with `code` and **bold**: enough markdown for review comments.
	let { text }: { text: string } = $props();
	const parts = $derived(text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean));
</script>

{#each parts as part, i (i)}{#if part.startsWith('`') && part.endsWith('`')}<code>{part.slice(1, -1)}</code>{:else if part.startsWith('**') && part.endsWith('**')}<strong>{part.slice(2, -2)}</strong>{:else}{part}{/if}{/each}
