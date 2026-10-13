<script lang="ts">
	import Spinner from '$lib/ui/Spinner.svelte';
	import type { Tone } from './startPage.svelte';

	// A round's state as a small mark: an open ring when it's ready, half
	// filled while it's being read, filled once read, a tick once posted, a
	// filled tick once complete; a dashed ring for one not prepared.
	let { tone, draft = false, complete = false }: { tone: Tone; draft?: boolean; complete?: boolean } = $props();
</script>

<span class="bauble {tone}" class:draft aria-hidden="true">
	{#if tone === 'working'}
		<Spinner size={14} />
	{:else}
		<svg width="16" height="16" viewBox="0 0 16 16">
			{#if draft || tone === 'quiet'}
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 2.2" />
			{:else if tone === 'new'}
				<circle cx="8" cy="8" r="4.5" fill="currentColor" />
			{:else if tone === 'ready'}
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
			{:else if tone === 'going'}
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
				<path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
			{:else if tone === 'read'}
				<circle cx="8" cy="8" r="6.25" fill="currentColor" />
			{:else if tone === 'done' && complete}
				<circle cx="8" cy="8" r="7" fill="currentColor" />
				<path d="M5.2 8.2l1.9 1.9 3.7-3.9" fill="none" stroke="var(--bg)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
			{:else if tone === 'done'}
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
				<path d="M5.2 8.2l1.9 1.9 3.7-3.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
			{:else if tone === 'bad'}
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
				<path d="M8 4.8v3.6M8 10.9v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
			{/if}
		</svg>
	{/if}
</span>

<style>
	.bauble {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		color: var(--faint);
	}
	.new {
		color: #c8a8ff;
	}
	.working {
		color: #e8e2d6;
	}
	.ready {
		color: #8ab4ff;
	}
	.going {
		color: #ffb85c;
	}
	.read {
		color: var(--muted);
	}
	.done {
		color: #7fd89b;
	}
	.bad {
		color: #ff8a7a;
	}
	.draft {
		color: #8ab4ff;
	}
</style>
