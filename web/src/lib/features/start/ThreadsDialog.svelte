<script lang="ts">
	import { untrack } from 'svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import InlineText from '$lib/ui/InlineText.svelte';
	import ThreadTriage from '$lib/features/threads/ThreadTriage.svelte';
	import { PrThreads } from '$lib/features/threads/prThreads.svelte';
	import type { PrRef } from '$lib/types';

	// A PR's GitHub threads gone through from the start page, without opening
	// - or starting - a review of it. What's checked here is the PR's, so its
	// review's Overview shows it too.
	let { pr, title, onunresolved, onclose }: { pr: PrRef; title: string; onunresolved: (n: number) => void; onclose: () => void } = $props();

	// One PR's, for as long as the dialog's open.
	const threads = new PrThreads(untrack(() => ({ owner: pr.owner, repo: pr.repo, number: pr.number })));
	$effect(() => {
		threads.load();
		return () => threads.close();
	});
	// The row's count follows what's resolved here.
	const unresolved = $derived(threads.data ? threads.threads.filter((t) => !t.resolved).length : null);
	$effect(() => {
		const n = unresolved;
		if (n !== null) untrack(() => onunresolved(n));
	});
</script>

<Dialog label="GitHub threads" width={760} {onclose}>
	<header>
		<span class="faint mono">{pr.owner}/{pr.repo} #{pr.number}</span>
		<span class="title"><InlineText text={title} /></span>
		<button class="icon close" aria-label="Close" title="Close" onclick={onclose}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<ThreadTriage {threads} />
</Dialog>

<style>
	header {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-right: 32px;
	}
	.mono {
		font-family: var(--mono);
		font-size: 12.5px;
	}
	.title {
		font-size: 15px;
		font-weight: 500;
	}
	.close {
		position: absolute;
		top: 0;
		right: 0;
	}
</style>
