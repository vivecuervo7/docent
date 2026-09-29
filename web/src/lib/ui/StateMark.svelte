<script lang="ts">
	// A step's state: done, current, or still to come.
	let { state, size = 16 }: { state: 'done' | 'now' | 'todo'; size?: number } = $props();
</script>

{#if state === 'done'}
	<svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"
		><circle cx="9" cy="9" r="9" fill="var(--done-bg)" /><path
			d="M5.2 9.3l2.5 2.5 5.1-5.3"
			stroke="var(--done)"
			stroke-width="2"
			fill="none"
			stroke-linecap="round"
			stroke-linejoin="round"
		/></svg
	>
{:else if state === 'now'}
	<svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"
		><circle cx="9" cy="9" r="8" stroke="var(--text)" stroke-width="2" fill="none" /><circle
			cx="9"
			cy="9"
			r="3.5"
			fill="var(--text)"
		/></svg
	>
{:else}
	<svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"
		><circle cx="9" cy="9" r="8" stroke="var(--todo)" stroke-width="2" fill="none" /></svg
	>
{/if}
