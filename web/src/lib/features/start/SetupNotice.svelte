<script lang="ts">
	import type { StartPage } from './startPage.svelte';

	// What Docent still needs before a review, above the PR link for as long as
	// something's missing. Getting started walks through setting it up.
	let { page }: { page: StartPage } = $props();

	const needs = $derived([!page.modelSources?.length && 'a model', !page.gh?.login && 'the GitHub CLI signed in'].filter(Boolean));
</script>

<div class="notice" role="status">
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
		><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg
	>
	<span class="text">Docent needs {needs.join(' and ')} before it can review.</span>
	<a class="btn primary" href="/getting-started">Getting started →</a>
</div>

<style>
	.notice {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 10px 10px 16px;
		border-radius: 12px;
		background: var(--agent-tint);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--agent) 28%, transparent);
		color: var(--agent-text);
		font-size: 14px;
	}
	svg {
		flex-shrink: 0;
		color: var(--agent);
	}
	.text {
		flex-grow: 1;
	}
	a {
		flex-shrink: 0;
		text-decoration: none;
	}
</style>
