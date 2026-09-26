<script lang="ts">
	import type { Severity } from '$lib/types';

	// How much a finding matters, in a word; the two that could hold a PR
	// stand out.
	let { severity }: { severity: Severity | undefined } = $props();
</script>

{#if severity}<span class="severity {severity}">{severity}</span>{/if}

<style>
	.severity {
		font-size: 11.5px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--faint);
		white-space: nowrap;
	}
	.blocker {
		color: var(--danger);
	}
	.major {
		color: var(--agent);
	}
</style>
