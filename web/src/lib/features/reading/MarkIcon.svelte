<script lang="ts">
	// A mark's shape: a finding's diamond, or a thread's speech bubble. It
	// takes its fill from where it sits.
	let { kind, small = false }: { kind: 'finding' | 'note'; small?: boolean } = $props();
</script>

{#if kind === 'finding'}
	<svg width={small ? 10 : 12} height={small ? 10 : 12} viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .6 11.4 6 6 11.4.6 6Z" /></svg>
{:else}
	<svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
{/if}
