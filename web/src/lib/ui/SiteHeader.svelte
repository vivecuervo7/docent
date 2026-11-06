<script lang="ts">
	import { page } from '$app/state';
	import ModelPicker from '$lib/features/start/ModelPicker.svelte';
	import { checkSetup, setup } from '$lib/features/settings/setup.svelte';
	import Avatar from './Avatar.svelte';
	import Icon from './Icon.svelte';
	import { onDismiss } from './dismiss';

	// The top of Docent's own pages, outside a review: home, which model
	// Docent uses, and the GitHub account gh acts as, which opens onto the
	// pages beside home.
	const links = [
		{ href: '/getting-started', label: 'Getting started', icon: 'book' },
		{ href: '/stats', label: 'Stats', icon: 'chart' },
		{ href: '/settings', label: 'Settings', icon: 'sliders' }
	] as const;

	// Not known until the setup check first answers, and shown as neither
	// signed in nor out till then.
	const loading = $derived(setup.current === undefined);
	const gh = $derived(setup.current?.gh);
	$effect(() => {
		if (loading) checkSetup().catch(() => {});
	});

	let open = $state(false);
	let account = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!open) return;
		return onDismiss(
			() => (open = false),
			(target) => !!account?.contains(target)
		);
	});
</script>

<header>
	<a class="brand" href="/">Docent</a>
	<div class="end">
		<ModelPicker />
		<div class="account" bind:this={account}>
			<button
				class="trigger"
				aria-expanded={open}
				aria-controls="account-menu"
				aria-label={loading ? 'GitHub account' : gh?.login ? `GitHub as @${gh.login}` : 'Not signed in to GitHub'}
				onclick={() => (open = !open)}
			>
				{#if loading}<span class="placeholder"></span>{:else}<Avatar src={gh?.avatar} name={gh?.login ?? '?'} size={34} />{/if}
			</button>
			{#if open}
				<nav class="menu" id="account-menu" aria-label="Account">
					<div class="who">
						{#if loading}
							<span class="faint">Checking the <code>gh</code> CLI…</span>
						{:else}
							<Avatar src={gh?.avatar} name={gh?.login ?? '?'} size={32} />
							<div>
								<strong>{gh?.login ? (gh.name ?? gh.login) : 'Not signed in'}</strong>
								<span class="faint">{gh?.login ? 'Signed in through the' : 'Sign in with the'} <code>gh</code> CLI</span>
							</div>
						{/if}
					</div>
					<hr />
					{#each links as { href, label, icon } (href)}
						<a
							class="item"
							class:current={page.url.pathname === href}
							aria-current={page.url.pathname === href ? 'page' : undefined}
							{href}
							onclick={() => (open = false)}
						>
							<Icon name={icon} size={16} />
							{label}
						</a>
					{/each}
				</nav>
			{/if}
		</div>
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
	.account {
		position: relative;
		display: flex;
	}
	.trigger {
		display: flex;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		cursor: pointer;
	}
	.placeholder {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 8px);
		right: 0;
		display: flex;
		flex-direction: column;
		min-width: 240px;
		padding: 6px;
		box-sizing: border-box;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			var(--shadow-menu);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 10px;
	}
	.who div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.who strong {
		font-size: 14px;
		font-weight: 600;
	}
	.who span {
		font-size: 12px;
		white-space: nowrap;
	}
	hr {
		align-self: stretch;
		margin: 6px 4px;
		border: 0;
		border-top: 1px solid var(--line-2);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 34px;
		padding: 0 10px;
		border-radius: 8px;
		color: var(--text);
		font-size: 14px;
		text-decoration: none;
	}
	.item :global(svg) {
		color: var(--muted);
	}
	.item:hover,
	.item.current {
		background: var(--line-2);
	}
</style>
