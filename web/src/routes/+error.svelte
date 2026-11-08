<script lang="ts">
	import { page } from '$app/state';
	import SiteHeader from '#lib/ui/SiteHeader.svelte';
</script>

<svelte:head><title>{page.status} · Docent</title></svelte:head>

<SiteHeader />
<main class="status">
	<h1>{page.status === 404 ? 'There’s nothing here' : 'Something went wrong'}</h1>
	{#if page.status !== 404}<p>{page.error?.message}</p>{/if}
	<a class="btn" href="/">Back to your reviews</a>
</main>

<style>
	.status {
		max-width: 640px;
		margin: 80px auto;
		padding: 0 24px;
		font-size: 15px;
	}
	h1 {
		margin: 0 0 12px;
		font-family: var(--serif);
		font-size: 38px;
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	.status .btn {
		text-decoration: none;
	}
</style>
