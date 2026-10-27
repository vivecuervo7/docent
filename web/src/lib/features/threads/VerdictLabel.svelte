<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Verdict } from './threads';

	// What checking a thread found, in its colour: addressed, or resolved, in
	// green; not yet in amber; the rest muted.
	let { verdict, size, children }: { verdict?: Verdict | 'resolved'; size?: number; children: Snippet } = $props();
</script>

<span class="verdict {verdict ?? ''}" style:font-size={size ? `${size}px` : undefined}>{@render children()}</span>

<style>
	.verdict {
		font-weight: 600;
		color: var(--muted);
	}
	.addressed,
	.resolved {
		color: var(--done);
	}
	.not-yet {
		color: var(--agent);
	}
</style>
