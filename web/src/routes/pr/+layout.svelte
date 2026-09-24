<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	// A different PR gets a fresh session: SvelteKit would otherwise reuse the
	// PR's layout across PRs.
	const prKey = $derived(`${page.params.owner}/${page.params.repo}/${page.params.number}`);
</script>

{#key prKey}
	{@render children()}
{/key}
