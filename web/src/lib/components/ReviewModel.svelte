<script lang="ts">
	import { onMount } from 'svelte';
	import { listModels } from '$lib/api';
	import { modelLabel } from '$lib/panel.svelte';
	import { useSession } from '$lib/session.svelte';
	import type { ModelOption } from '$lib/types';

	// This review's model, changeable for it alone. Until it's first prepared
	// it follows the start page's.
	const session = useSession();
	let options = $state<ModelOption[]>([]);
	let fallback = $state('');
	let open = $state(false);

	onMount(() => {
		listModels()
			.then((m) => {
				options = m.options;
				fallback = m.selected;
			})
			.catch(() => {});
	});

	const current = $derived(session.model ?? fallback);
	const label = $derived(options.find((o) => o.id === current)?.label ?? (current ? modelLabel(current) : ''));
	const groups = $derived(Object.entries(Object.groupBy(options, (o) => o.source)));

	function choose(id: string) {
		open = false;
		if (id !== session.model) session.setModel(id);
	}

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.review-model')) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

{#if label}
	<span class="review-model">
		<button class="trigger" aria-haspopup="menu" aria-expanded={open} title="The model this review uses" onclick={() => (open = !open)}>
			{label}
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
		</button>
		{#if open}
			<div class="menu" role="menu" aria-label="This review's model">
				<span class="note">For this review only</span>
				{#each groups as [source, items] (source)}
					<span class="group">{source}</span>
					{#each items ?? [] as o (o.id)}
						<button role="menuitemradio" aria-checked={o.id === current} onclick={() => choose(o.id)}>
							<span class="tick">{#if o.id === current}✓{/if}</span>
							<span>{o.label}</span>
						</button>
					{/each}
				{/each}
			</div>
		{/if}
	</span>
{/if}

<style>
	.review-model {
		position: relative;
		display: inline-block;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 6px;
		margin: 0 -6px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--muted);
		font: inherit;
		cursor: pointer;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		color: var(--text);
		background: var(--surface-2);
	}
	.menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		left: -8px;
		min-width: 230px;
		max-height: 60vh;
		overflow-y: auto;
		padding: 6px;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.note {
		padding: 6px 10px 2px;
		font-size: 12px;
		color: var(--faint);
	}
	.group {
		padding: 8px 10px 4px;
		font-size: 11px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	.menu button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--line-2);
	}
	.tick {
		color: var(--done);
		font-size: 13px;
	}
</style>
