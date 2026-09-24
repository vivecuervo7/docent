<script lang="ts">
	import { goto } from '$app/navigation';
	import { listModels } from '$lib/api';
	import { agentInstruction, modelLabel, nameOf, setupFrom, type ReviewerSetup } from '$lib/panel.svelte';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';
	import { FIRST_AGENT, type AgentId, type AgentReviewer, type ModelOption } from '$lib/types';
	import Spinner from './Spinner.svelte';

	// Mockup A's "Start your review panel": the PR's agent reviewers, what
	// each runs with, and one button to start them and begin reading.

	const session = useSession();
	const panel = session.panel;

	let models = $state<ModelOption[]>([]);
	let defaultModel = $state('');
	$effect(() => {
		listModels()
			.then((m) => {
				models = m.options;
				defaultModel = m.selected;
			})
			.catch(() => {});
	});

	let ticked = $state<Partial<Record<AgentId, boolean>>>({});
	let starting = $state(false);

	const setupOf = (r: AgentReviewer): ReviewerSetup => setupFrom(r, defaultModel);
	// Reviewers that haven't run are ticked to start; rerunning one replaces
	// its findings, so that's opted into.
	const isTicked = (r: AgentReviewer) => ticked[r.id] ?? (!r.ranWith && panel.findings(r.id) === 0);
	const isRunning = (r: AgentReviewer) => panel.reviews[r.id]?.status === 'running';

	const toStart = $derived(panel.reviewers.filter((r) => isTicked(r) && !isRunning(r)));
	const anyRan = $derived(panel.reviewers.some((r) => r.ranWith || panel.findings(r.id) > 0 || panel.reviews[r.id]));
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);

	// What runs a reviewer, as its menu shows it.
	function runsWith(r: AgentReviewer): string {
		const setup = setupOf(r);
		return setup.mode === 'external' ? 'Your own agent' : `Docent · ${modelLabel(setup.model)}`;
	}

	function choose(r: AgentReviewer, value: string) {
		panel.plan(r.id, value === 'external' ? { mode: 'external' } : { mode: 'builtin', model: value });
	}

	function read() {
		const next = session.slices.find((s) => !isSliceReviewed(s, session.reviewed)) ?? session.slices[0];
		if (next) goto(`${base}/slices/${next.id}`);
	}

	async function startAndRead() {
		starting = true;
		const started = [...toStart];
		await Promise.all(started.map((r) => panel.start(r.id, setupOf(r))));
		for (const r of started) ticked[r.id] = false;
		starting = false;
		// Your own agent needs its command run first, so that stays in view.
		const failed = started.some((r) => panel.errors[r.id]);
		const needsCommand = started.some((r) => setupOf(r).mode === 'external');
		if (!failed && !needsCommand) read();
	}

	async function add() {
		const id = await panel.add();
		ticked[id] = true;
	}

	async function remove(r: AgentReviewer) {
		const n = panel.findings(r.id);
		if (n > 0 && !confirm(`Remove ${nameOf(r)}? Its ${n} ${n === 1 ? 'finding' : 'findings'} will be discarded.`)) return;
		await panel.remove(r.id);
	}

	// The reviewer whose "what runs it" menu is open.
	let menuFor = $state<AgentId | null>(null);
	$effect(() => {
		if (!menuFor) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.picker')) menuFor = null;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});

	let copied = $state<AgentId | null>(null);
	function copy(r: AgentReviewer) {
		navigator.clipboard.writeText(agentInstruction(session, r)).then(() => {
			copied = r.id;
			setTimeout(() => (copied = null), 1500);
		});
	}
</script>

<div class="card">
	{#if !anyRan}
		<span class="kicker">
			<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" /></svg>
			Before you start reading
		</span>
	{/if}
	<h2>{anyRan ? 'Your review panel' : 'Start your review panel'}</h2>
	<p class="lede">They review while you read. What they find is pinned on the code, beside your own notes.</p>

	<ul>
		{#each panel.reviewers as r (r.id)}
			{@const review = panel.reviews[r.id]}
			{@const setup = setupOf(r)}
			{@const running = review?.status === 'running'}
			{@const found = panel.findings(r.id)}
			<li>
				<div class="text">
					<div class="picker">
						<span class="name">{nameOf(r)}</span>
						{#if running}
							<span class="runs faint">{runsWith(r)}</span>
						{:else}
							<button
								class="trigger"
								aria-haspopup="menu"
								aria-label="What runs {nameOf(r)}: {runsWith(r)}"
								aria-expanded={menuFor === r.id}
								onclick={() => (menuFor = menuFor === r.id ? null : r.id)}
							>
								{runsWith(r)}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
							</button>
						{/if}
						{#if menuFor === r.id}
							<div class="menu" role="menu" aria-label="What runs this reviewer">
								<span class="group">Docent’s reviewer</span>
								{#each models as m (m.id)}
									{@const current = setup.mode === 'builtin' && setup.model === m.id}
									<button role="menuitemradio" aria-checked={current} onclick={() => { choose(r, m.id); menuFor = null; }}>
										<span class="tick">{#if current}✓{/if}</span>
										<span>{m.label}</span>
										<span class="hint">{m.group === 'claude-code' ? 'Claude Code' : 'Endpoint'}</span>
									</button>
								{/each}
								<span class="group">Your own agent</span>
								<button role="menuitemradio" aria-checked={setup.mode === 'external'} onclick={() => { choose(r, 'external'); menuFor = null; }}>
									<span class="tick">{#if setup.mode === 'external'}✓{/if}</span>
									<span>Claude Code or any MCP agent</span>
								</button>
							</div>
						{/if}
					</div>

					{#if running && review.source === 'builtin'}
						<span class="status working">
							<Spinner size={13} />
							{review.progress?.total
								? `Reviewing ${review.progress.current ?? '…'} (${Math.min(review.progress.done + 1, review.progress.total)} of ${review.progress.total})`
								: 'Starting…'}
							<button class="link" onclick={() => panel.end(r.id, 'stop')}>Stop</button>
						</span>
					{:else if running}
						<span class="status working">
							<Spinner size={13} />
							Waiting for your agent{found ? ` · ${found} so far` : ''}
							<button class="link" onclick={() => panel.end(r.id, 'finish')}>Finish</button>
							<button class="link" onclick={() => panel.end(r.id, 'stop')}>Cancel</button>
						</span>
					{:else if review?.status === 'failed'}
						<span class="status bad">Stopped with an error: {review.error}</span>
					{:else if panel.errors[r.id]}
						<span class="status bad">Couldn’t start: {panel.errors[r.id]}</span>
					{:else if found || review}
						<span class="status faint">
							{found} {found === 1 ? 'finding' : 'findings'}{review?.status === 'stopped' ? ' · stopped' : ''}{isTicked(r) ? ' · runs again, replacing them' : ''}
						</span>
					{/if}

					{#if setup.mode === 'external' && (running || isTicked(r))}
						<span class="tell faint">After your usual review, tell your agent:</span>
						<span class="command">
							<span class="sentence">{agentInstruction(session, r)}</span>
							<button class="icon" aria-label="Copy what to tell your agent" onclick={() => copy(r)}>
								{#if copied === r.id}
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--done)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
								{:else}
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
								{/if}
							</button>
						</span>
					{/if}
				</div>

				<div class="controls">
					{#if !running}
						<button
							class="switch"
							role="switch"
							aria-checked={isTicked(r)}
							aria-label="Start {nameOf(r)}"
							onclick={() => (ticked[r.id] = !isTicked(r))}
						>
							<span></span>
						</button>
					{/if}
					{#if r.id !== FIRST_AGENT}
						<button class="icon remove" aria-label="Remove {nameOf(r)}" onclick={() => remove(r)}>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
						</button>
					{:else}
						<span class="remove" aria-hidden="true"></span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	<div class="add-row">
		<button class="add" onclick={add}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
			Add a reviewer
		</button>
		{#if defaultModel && !panel.isDefault(defaultModel)}
			<button class="link default" onclick={() => panel.saveAsDefault(defaultModel)}>Make this my default panel</button>
		{/if}
	</div>

	<div class="actions">
		{#if toStart.length}
			<button class="btn primary big" disabled={starting} onclick={startAndRead}>
				<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" fill="currentColor" /></svg>
				Start {toStart.length === panel.reviewers.length && toStart.length > 1 ? 'the panel' : toStart.length === 1 ? 'reviewer' : `${toStart.length} reviewers`} and read
			</button>
			<button class="btn big" onclick={read}>Just read</button>
		{:else}
			<button class="btn primary big" onclick={read}>{session.reviewedSlices ? 'Continue reading' : 'Start reading'}</button>
		{/if}
	</div>
</div>

<style>
	.card {
		background: #1b1813;
		border-radius: 20px;
		padding: 28px 28px 24px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		box-shadow:
			0 0 0 1px #2e281d,
			0 24px 60px -30px rgba(240, 169, 75, 0.25);
	}
	.kicker {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--agent);
		font-size: 11.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
	}
	h2 {
		margin: 6px 0 4px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
		line-height: 1.2;
	}
	.lede {
		margin: 0 0 12px;
		color: var(--muted);
		font-size: 14.5px;
		line-height: 1.55;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding: 14px 0;
		border-top: 1px solid #2a261f;
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.name {
		font-size: 15px;
		font-weight: 500;
	}
	.picker {
		position: relative;
		align-self: flex-start;
	}
	.picker {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}
	.runs {
		font-size: 13px;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin: 0 0 0 -7px;
		padding: 2px 7px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.trigger svg {
		color: var(--faint);
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		background: #26221a;
	}
	.menu {
		position: absolute;
		z-index: 10;
		top: calc(100% + 6px);
		left: -8px;
		min-width: 280px;
		padding: 6px;
		border-radius: 12px;
		background: #221e17;
		box-shadow:
			0 0 0 1px #3a3226,
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.menu .group {
		padding: 8px 10px 4px;
		font-size: 11px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--faint);
	}
	.menu button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		height: 34px;
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
		background: #2e281e;
	}
	.tick {
		color: var(--agent);
		font-size: 13px;
	}
	.hint {
		font-size: 12px;
		color: var(--faint);
	}
	.status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 13px;
		line-height: 1.4;
	}
	.status.working {
		color: var(--agent-text);
	}
	.status.bad {
		color: var(--danger);
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.command {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
	}
	.tell {
		margin-top: 4px;
		font-size: 12.5px;
	}
	.command {
		align-items: flex-start;
	}
	.sentence {
		min-width: 0;
		font-size: 13.5px;
		line-height: 1.5;
		color: #e6d6b8;
		background: #14120e;
		padding: 8px 11px;
		border-radius: 9px;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-top: 1px;
	}
	.remove {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
	}
	.switch {
		position: relative;
		width: 38px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 11px;
		background: #34363c;
		cursor: pointer;
		flex-shrink: 0;
	}
	.switch span {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		border-radius: 8px;
		background: var(--faint);
		transition: transform 0.15s;
	}
	.switch[aria-checked='true'] {
		background: #e8e6e1;
	}
	.switch[aria-checked='true'] span {
		transform: translateX(16px);
		background: #141413;
	}
	.add-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 2px 0 14px;
		border-top: 1px solid #2a261f;
	}
	.default {
		font-size: 12.5px;
		white-space: nowrap;
	}
	.add {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		border: 0;
		background: none;
		color: var(--faint);
		font: inherit;
		font-size: 13.5px;
		cursor: pointer;
	}
	.add:hover {
		color: var(--text);
	}
	.actions {
		display: flex;
		gap: 10px;
	}
	.big {
		height: 44px;
		padding: 0 18px;
		border-radius: 12px;
		font-size: 14.5px;
	}
	.actions .primary {
		flex-grow: 1;
		justify-content: center;
	}
	.actions .primary:disabled {
		opacity: 0.6;
		cursor: progress;
	}
</style>
