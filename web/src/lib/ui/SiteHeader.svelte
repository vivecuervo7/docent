<script lang="ts">
	import ModelPicker from '$lib/features/start/ModelPicker.svelte';
	import AccountMenu from './AccountMenu.svelte';

	// The top of Docent's own pages, outside a review: home, which model
	// Docent uses, and the GitHub account gh acts as.
</script>

<header>
	<a class="brand" href="/">Docent</a>
	<div class="end">
		<ModelPicker />
		<AccountMenu />
	</div>
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
	.end {
		display: flex;
		align-items: center;
		gap: 20px;
	}
</style>
