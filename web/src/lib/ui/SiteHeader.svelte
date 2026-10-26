<script lang="ts">
	import { page } from '$app/state';
	import ModelPicker from '$lib/features/start/ModelPicker.svelte';

	// The top of Docent's own pages, outside a review: home, the pages beside
	// it, and which model Docent uses.
	const links = [
		{ href: '/getting-started', label: 'Getting started' },
		{ href: '/stats', label: 'Stats' },
		{ href: '/settings', label: 'Settings' }
	];
</script>

<header>
	<a class="brand" href="/">Docent</a>
	<nav>
		{#each links as { href, label } (href)}
			<a class="link faint" class:current={page.url.pathname === href} aria-current={page.url.pathname === href ? 'page' : undefined} {href}>{label}</a>
		{/each}
		<ModelPicker />
	</nav>
</header>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 64px;
		padding: 0 28px;
	}
	.brand {
		font-family: var(--serif);
		font-size: 21px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.link {
		font-size: 13.5px;
		text-decoration: none;
	}
	.link:hover,
	.link.current {
		color: var(--text);
	}
</style>
