<script lang="ts">
	import { answer, question } from '$lib/confirm.svelte';
	import Dialog from './Dialog.svelte';

	// The one confirmation dialog, shown whenever `ask` is waiting.
	let confirmButton = $state<HTMLButtonElement | null>(null);
	$effect(() => {
		if (question.current) requestAnimationFrame(() => confirmButton?.focus());
	});
</script>

{#if question.current}
	<Dialog label={question.current.title} width={440} onclose={() => answer(false)}>
		<h2>{question.current.title}</h2>
		{#if question.current.body}<p>{question.current.body}</p>{/if}
		<div class="actions">
			<button class="btn" onclick={() => answer(false)}>Cancel</button>
			<button class="btn primary" bind:this={confirmButton} onclick={() => answer(true)}>{question.current.action}</button>
		</div>
	</Dialog>
{/if}

<style>
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
		line-height: 1.25;
	}
	p {
		margin: 0;
		color: var(--muted);
		font-size: 14.5px;
		line-height: 1.6;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding-top: 4px;
	}
</style>
