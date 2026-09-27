<script lang="ts">
	import InlineText from './InlineText.svelte';

	// What the panel's editor found about a finding, each folded behind its
	// verdict in a word, so the verdict shows and the detail is a click away.
	let {
		impact,
		impactLevel,
		checked,
		checkedVerdict,
		speculative,
		size = 13.5
	}: {
		impact?: string;
		impactLevel?: string;
		checked?: string;
		checkedVerdict?: string;
		speculative?: string;
		size?: number;
	} = $props();

	let open = $state<Record<string, boolean>>({});
	const notes = $derived(
		[
			impact && { key: 'impact', label: `Impact${impactLevel ? `: ${impactLevel}` : ''}`, text: impact },
			checked && { key: 'checked', label: `Checked${checkedVerdict ? `: ${checkedVerdict}` : ''}`, text: checked },
			speculative && { key: 'assumes', label: 'Assumes', text: speculative }
		].filter((n): n is { key: string; label: string; text: string } => !!n)
	);
</script>

{#each notes as n (n.key)}
	<button class="fold" style:font-size="{size - 1}px" aria-expanded={!!open[n.key]} onclick={() => (open[n.key] = !open[n.key])}>
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={open[n.key] ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
		{n.label}
	</button>
	{#if open[n.key]}<p class="text" style:font-size="{size - 1}px"><InlineText text={n.text} /></p>{/if}
{/each}

<style>
	.fold {
		display: flex;
		align-items: center;
		gap: 4px;
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--faint);
		font: inherit;
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
	}
	.text {
		margin: 0 0 0 17px;
		line-height: 1.55;
		color: var(--muted);
	}
</style>
