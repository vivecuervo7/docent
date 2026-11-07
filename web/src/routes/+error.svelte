<script lang="ts">
	import { page } from '$app/state';
	import SiteHeader from '#lib/ui/SiteHeader.svelte';
</script>

<svelte:head><title>{page.status} · Docent</title></svelte:head>

<SiteHeader />
<main class="status">
	<p>{page.status === 404 ? 'There’s nothing here.' : `Something went wrong: ${page.error?.message}`}</p>
	<a class="btn" href="/">Back to your reviews</a>
</main>

<style>
	.status {
		max-width: 640px;
		margin: 80px auto;
		padding: 0 24px;
		font-size: 15px;
	}
	.status .btn {
		text-decoration: none;
	}
</style>
