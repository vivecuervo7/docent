<script lang="ts">
	import InlineText from './InlineText.svelte';
	import { modelLabel } from '$lib/panel.svelte';
	import ReviewModel from './ReviewModel.svelte';
	import { elapsed } from '$lib/format';
	import { isGenerating, useSession } from '$lib/session.svelte';
	import type { StepName } from '$lib/types';
	import Spinner from './Spinner.svelte';
	import StateMark from './StateMark.svelte';

	const session = useSession();

	const STEPS: { step: StepName; label: string }[] = [
		{ step: 'slices', label: 'Breaking the PR into slices' },
		{ step: 'conversation', label: 'Reading the review conversation' },
		{ step: 'summary', label: 'Writing the summary' },
		{ step: 'notes', label: 'Noting what the tests and larger changes do' }
	];

	const generation = $derived(session.generation);
	const failed = $derived(generation?.status === 'failed');
	const stopped = $derived(generation?.status === 'stopped');
	// Picking another model after stopping means starting again: resuming
	// would finish the review with two.
	const modelChanged = $derived(!!generation?.model && !!session.model && generation.model !== session.model);
	const running = $derived(isGenerating(generation));

	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
</script>

<div class="wrap">
	<div class="card">
		<span class="caps" class:bad={failed}>
			{failed
				? 'Preparing this review failed'
				: stopped
					? 'You stopped preparing this review'
					: generation?.status === 'queued'
						? 'Waiting for another review to finish'
						: 'Preparing your review'}
		</span>
		<h1><InlineText text={session.title} /></h1>
		<span class="faint mono">{session.ref.owner}/{session.ref.repo} #{session.ref.number} · <ReviewModel /></span>

		<ol>
			<li>
				<StateMark state="done" size={18} />
				<span>Fetched the PR and its {session.files.length} {session.files.length === 1 ? 'file' : 'files'}</span>
			</li>
			{#each STEPS as { step, label } (step)}
				{@const state = generation?.steps[step]}
				<li class:pending={!state || state.status === 'pending'} class:active={state?.status === 'active'}>
					{#if state?.status === 'done'}
						<StateMark state="done" size={18} />
					{:else if state?.status === 'active' && running}
						<Spinner size={18} label="In progress" />
					{:else}
						<StateMark state="todo" size={18} />
					{/if}
					<span>{label}</span>
					{#if state?.status === 'active' && running && state.startedAt}
						<span class="time mono faint">{elapsed(now - state.startedAt)}</span>
					{/if}
				</li>
			{/each}
		</ol>

		{#if failed}
			<div class="problem">
				<p>{generation?.error ?? 'Something went wrong.'}</p>
				<button class="btn primary" onclick={() => session.prepare()}>Try again</button>
			</div>
		{:else if stopped}
			<div class="actions">
				{#if modelChanged}
					<button class="btn primary" onclick={() => session.prepare({ fresh: true })}>Start again with {modelLabel(session.model ?? '')}</button>
				{:else}
					<button class="btn primary" onclick={() => session.prepare()}>Resume</button>
				{/if}
			</div>
		{:else}
			<div class="actions">
				<button class="btn" onclick={() => session.stopPreparing()}>Stop</button>
				<span class="faint">This keeps going if you leave.</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.wrap {
		min-height: calc(100vh - 64px);
		display: grid;
		place-items: center;
		padding: 40px 24px;
		box-sizing: border-box;
	}
	.card {
		width: 100%;
		max-width: 540px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.caps {
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--agent);
	}
	.caps.bad {
		color: var(--danger);
	}
	h1 {
		margin: 4px 0 0;
		font-family: var(--serif);
		font-weight: 500;
		font-size: 32px;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}
	.mono {
		font-family: var(--mono);
		font-size: 13px;
	}
	ol {
		list-style: none;
		margin: 26px 0 8px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
		font-size: 15px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	li.pending {
		color: var(--faint);
	}
	li.active {
		font-weight: 500;
	}
	.time {
		margin-left: auto;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-top: 16px;
		font-size: 13.5px;
	}
	.actions .btn {
		white-space: nowrap;
	}
	.problem {
		margin-top: 16px;
		padding: 16px 18px;
		border-radius: 12px;
		background: #2a1c1e;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.problem p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: #f1d3d0;
	}
</style>
