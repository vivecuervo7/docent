<script lang="ts">
	import InlineText from '../../ui/InlineText.svelte';

	// What the panel's editor found about a finding, each folded behind its
	// verdict in a word, so the verdict shows and the detail is a click away.
	// Styled like the place's own "Why it was raised", which follows them.
	let {
		impact,
		impactLevel,
		checked,
		checkedVerdict,
		speculative,
		onPr,
		setAside,
		fontSize = 13,
		chevron = 14,
		tone = 'muted',
		boxed = false
	}: {
		impact?: string;
		impactLevel?: string;
		checked?: string;
		checkedVerdict?: string;
		speculative?: string;
		onPr?: string;
		setAside?: string;
		fontSize?: number;
		chevron?: number;
		tone?: 'muted' | 'faint';
		// Each note opens in a box, like the reasoning beside it.
		boxed?: boolean;
	} = $props();

	let open = $state<Record<string, boolean>>({});
	const notes = $derived(
		[
			impact && { key: 'impact', label: `Impact${impactLevel ? `: ${impactLevel}` : ''}`, text: impact },
			checked && { key: 'checked', label: `Checked${checkedVerdict ? `: ${checkedVerdict}` : ''}`, text: checked },
			speculative && { key: 'speculative', label: 'Speculative', text: `Assumes: ${speculative}` },
			onPr && { key: 'on-pr', label: 'Already on the PR', text: onPr },
			setAside && { key: 'set-aside', label: 'Set aside', text: `Its reviewer set this aside: ${setAside}` }
		].filter((n): n is { key: string; label: string; text: string } => !!n)
	);
</script>

{#each notes as n (n.key)}
	<button
		class="fold"
		style:font-size="{fontSize}px"
		style:color="var(--{tone})"
		aria-expanded={!!open[n.key]}
		onclick={() => (open[n.key] = !open[n.key])}
	>
		<svg width={chevron} height={chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={open[n.key] ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
		{n.label}
	</button>
	{#if open[n.key]}
		{#if boxed}
			<p class="text boxed"><InlineText text={n.text} /></p>
		{:else}
			<p class="text" style:font-size="{fontSize}px" style:padding-left="{chevron + 6}px"><InlineText text={n.text} /></p>
		{/if}
	{/if}
{/each}

<style>
	.fold {
		display: flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text) !important;
	}
	.text {
		margin: 0;
		line-height: 1.55;
		color: var(--muted);
	}
	.text.boxed {
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--popover) 50%, var(--surface-2));
		font-size: 13.5px;
		line-height: 1.6;
	}
</style>
