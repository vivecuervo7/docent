<script lang="ts">
	import Floating from '../../ui/Floating.svelte';
	import InlineText from '../../ui/InlineText.svelte';

	// What the panel's editor found about a finding, in a word each, for the
	// row's header: the explanation shows over the row on hover or a click.
	let {
		impact,
		impactLevel,
		checked,
		checkedVerdict,
		speculative,
		onPr,
		setAside
	}: {
		impact?: string;
		impactLevel?: string;
		checked?: string;
		checkedVerdict?: string;
		speculative?: string;
		onPr?: string;
		setAside?: string;
	} = $props();

	const verdicts = $derived(
		[
			impact && { key: 'impact', word: impactLevel ? `${impactLevel} impact` : 'impact', title: 'Impact', text: impact },
			checked && { key: 'checked', word: checkedVerdict ?? 'checked', title: 'Checked against the code', text: checked },
			speculative && { key: 'speculative', word: 'speculative', title: 'Speculative', text: `Assumes: ${speculative}` },
			onPr && { key: 'on-pr', word: 'on the PR', title: 'Already on the PR', text: onPr },
			setAside && { key: 'set-aside', word: 'set aside', title: 'Set aside', text: `Its reviewer set this aside: ${setAside}` }
		].filter((v): v is { key: string; word: string; title: string; text: string } => !!v)
	);

	let shown = $state<{ key: string; pinned: boolean } | null>(null);
	let anchors = $state<Record<string, HTMLElement>>({});

	$effect(() => {
		if (!shown?.pinned) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.verdict')) shown = null;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

{#each verdicts as v (v.key)}
	<button
		class="verdict"
		bind:this={anchors[v.key]}
		aria-expanded={shown?.key === v.key}
		onmouseenter={() => !shown?.pinned && (shown = { key: v.key, pinned: false })}
		onmouseleave={() => !shown?.pinned && (shown = null)}
		onfocus={() => !shown?.pinned && (shown = { key: v.key, pinned: false })}
		onblur={() => !shown?.pinned && (shown = null)}
		onclick={() => (shown = shown?.key === v.key && shown.pinned ? null : { key: v.key, pinned: true })}>{v.word}</button
	>
	{#if shown?.key === v.key}
		<Floating anchor={anchors[v.key]} placement="top-start" fallback={['bottom-start']} label={v.title} tone="agent">
			<div class="card">
				<span class="title">{v.title}</span>
				<p><InlineText text={v.text} /></p>
			</div>
		</Floating>
	{/if}
{/each}

<style>
	.verdict {
		padding: 0;
		border: 0;
		background: none;
		color: var(--faint);
		font: inherit;
		font-size: 12px;
		white-space: nowrap;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		cursor: help;
	}
	.verdict:hover,
	.verdict[aria-expanded='true'] {
		color: var(--text);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 360px;
		padding: 12px 14px;
		font-family: var(--sans);
		white-space: normal;
	}
	.title {
		font-size: 12px;
		color: var(--faint);
	}
	p {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--muted);
	}
</style>
