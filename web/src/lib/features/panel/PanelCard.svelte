<script lang="ts">
	import { goto } from '$app/navigation';
	import { ask } from '$lib/ui/confirm.svelte';
	import { listModels } from '../../api/client';
	import { agentInstruction, AUTO_PERSONA, isAuto, modelLabel, nameOf, setupFrom, setupValue, type ReviewerSetup } from '$lib/features/panel/panel.svelte';
	import { isSliceReviewed, useSession } from '$lib/session/session.svelte';
	import { FIRST_AGENT, type AgentId, type AgentReviewer, type ModelOption } from '$lib/types';
	import Menu from '$lib/ui/Menu.svelte';
	import Spinner from '../../ui/Spinner.svelte';

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
		if (setup.mode === 'external') return 'Your own agent';
		if (setup.mode === 'session') return `External · ${panel.externalName(`session:${setup.session}`)}`;
		return modelLabel(setup.model);
	}

	// Choosing a model keeps the reviewer's persona.
	// A choice from a reviewer's "what runs it" menu: a model for Docent's
	// reviewer, keeping its persona, an external reviewer, or your own agent.
	function choose(r: AgentReviewer, value: string) {
		const setup = setupOf(r);
		const persona = setup.mode === 'builtin' ? setup.persona : undefined;
		if (value === 'external') panel.plan(r.id, { mode: 'external' });
		else if (value.startsWith('session:')) panel.plan(r.id, { mode: 'session', session: value.slice('session:'.length) });
		else panel.plan(r.id, { mode: 'builtin', model: value, persona });
	}

	// What can run a reviewer, as its menu lists it.
	const runOptions = $derived([
		{ heading: 'Docent’s reviewer', items: models.map((m) => ({ value: m.id, label: m.label, hint: m.source })) },
		...(panel.externals.length
			? [
					{
						heading: 'External reviewers',
						items: panel.externals.map((e) => ({
							value: `session:${e.id}`,
							label: e.name,
							hint: `${e.runner === 'codex' ? 'Codex' : 'Claude Code'}${e.model ? ` · ${e.model}` : ''}`
						}))
					}
				]
			: []),
		{ heading: 'Your own agent', items: [{ value: 'external', label: 'Connect via MCP' }] }
	]);
	const personaOptions = $derived([
		{
			items: [
				{ value: AUTO_PERSONA, label: 'Auto', hint: 'Picks the personas this PR warrants' },
				{ value: '', label: 'general', hint: 'Correctness, clarity, tests and risk' },
				...panel.personas.map((p) => ({ value: p.id, label: p.name }))
			]
		}
	]);

	// How many of an "auto"'s picks are still reviewing.
	const picksRunning = (r: AgentReviewer) => panel.reviewers.filter((a) => a.pickedBy === r.id && isRunning(a)).length;

	function choosePersona(r: AgentReviewer, persona: string | undefined) {
		const setup = setupOf(r);
		if (setup.mode === 'builtin') panel.plan(r.id, { ...setup, persona });
	}

	// Picks whose reason is open.
	let showWhy = $state<Partial<Record<AgentId, boolean>>>({});


	function read() {
		const next = session.slices.find((s) => !isSliceReviewed(s, session.reviewed)) ?? session.slices[0];
		if (next) goto(`${base}/slices/${next.id}`);
	}

	// An "auto" started now replaces its picks, so they aren't started too.
	const replacing = $derived(new Set(toStart.filter(isAuto).map((r) => r.id)));

	// Starting belongs to the PR, not this page, so reading begins at once
	// while the reviewers start - auto's picking included - and a reviewer
	// that fails to start says so on the panel chip. Your own agent needs
	// its command run first, so that stays in view.
	function startAndRead() {
		const started = toStart.filter((r) => !(r.pickedBy && replacing.has(r.pickedBy)));
		for (const r of started) ticked[r.id] = false;
		const needsCommand = started.some((r) => setupOf(r).mode === 'external');
		for (const r of started) panel.start(r.id, setupOf(r));
		if (!needsCommand) read();
	}

	async function add() {
		const id = await panel.add();
		ticked[id] = true;
	}

	async function remove(r: AgentReviewer) {
		const n = panel.findings(r.id);
		if (n > 0 && !(await ask({ title: `Remove ${nameOf(r, panel.reviewers)}?`, body: `Its ${n} ${n === 1 ? 'finding' : 'findings'} will be discarded.`, action: 'Remove' }))) return;
		await panel.remove(r.id);
	}


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
			<li class:picked={!!r.pickedBy}>
				<div class="text">
					<div class="picker">
						<span class="name">{nameOf(r, panel.reviewers)}</span>
						<div class="choices">
						{#if running}
							<span class="runs faint">{runsWith(r)}</span>
						{:else}
							<Menu
								groups={runOptions}
								value={setupValue(setup)}
								onchoose={(v) => choose(r, v)}
								label="What runs this reviewer"
								tone="agent"
								width={292}
								placement="outside"
							>
								{#snippet trigger({ open, toggle })}
									<button
										class="trigger"
										aria-haspopup="menu"
										aria-label="What runs {nameOf(r, panel.reviewers)}: {runsWith(r)}"
										aria-expanded={open}
										onclick={toggle}
									>
										{runsWith(r)}
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
									</button>
								{/snippet}
							</Menu>
						{/if}
						{#if setup.mode === 'builtin' && (panel.personas.length || setup.persona)}
							<span class="dot faint" aria-hidden="true">·</span>
							{#if running}
								<span class="runs faint">{panel.personaName(setup.persona)}</span>
							{:else}
								<Menu
									groups={personaOptions}
									value={setup.persona ?? ''}
									onchoose={(v) => choosePersona(r, v || undefined)}
									label="Persona"
									tone="agent"
									width={292}
									placement="outside"
								>
									{#snippet trigger({ open, toggle })}
										<button
											class="trigger"
											aria-haspopup="menu"
											aria-label="Persona for {nameOf(r, panel.reviewers)}: {panel.personaName(setup.persona)}"
											aria-expanded={open}
											onclick={toggle}
										>
											{panel.personaName(setup.persona)}
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
										</button>
									{/snippet}
								</Menu>
							{/if}
						{/if}
						</div>
					</div>

					{#if isAuto(r)}
						{#if panel.picking[r.id]}
							<span class="status working"><Spinner size={13} /> Picking the personas this PR warrants</span>
						{:else if panel.errors[r.id]}
							<span class="status bad">Couldn’t pick: {panel.errors[r.id]}</span>
						{:else if picksRunning(r)}
							<span class="status working"><Spinner size={13} /> {picksRunning(r)} {picksRunning(r) === 1 ? 'pick' : 'picks'} reviewing</span>
						{:else if r.picks}
							<span class="status faint">
								{r.picks.personas.length
									? `Picked ${[...(r.picks.general ? ['general'] : []), ...r.picks.personas.map((p) => panel.personaName(p))].join(', ')}`
									: r.picks.general
										? 'Picked general: nothing here warrants a specialist'
										: panel.hasGeneral
											? 'Picked none: the general reviewer already on the panel covers it'
											: 'Picked none: nothing here warrants a specialist'}{isTicked(r) ? ' · picks again, replacing them' : ''}
							</span>
						{/if}
					{:else if running && review.source === 'builtin'}
						<span class="status working">
							<Spinner size={13} />
							{!review.progress?.total
								? 'Starting…'
								: review.progress.waiting
									? 'Waiting for its turn'
									: review.progress.current === 'the whole PR'
									? 'Reading the whole PR first'
									: review.progress.current === 'the code around it'
									? 'Looking up the code around it'
									: review.progress.current === 'the PR as a whole'
									? 'Reviewing the PR as a whole'
									: `Reviewing ${review.progress.current ?? '…'} (${Math.max(1, Math.min(review.progress.done, review.progress.total - 1))} of ${review.progress.total - 1})`}
							<button class="link" onclick={() => panel.end(r.id, 'stop')}>Stop</button>
						</span>
					{:else if running && review.source === 'session'}
						{@const external = panel.externals.find((e) => `session:${e.id}` === (r.ranWith ?? ''))}
						<span class="status working">
							<Spinner size={13} />
							Reviewing in a {external?.runner === 'codex' ? 'Codex' : 'Claude Code'} session
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
					{:else if !review && r.lastRun?.status === 'failed'}
						<span class="status bad">Stopped with an error{r.lastRun.error ? `: ${r.lastRun.error}` : ''}</span>
					{:else if panel.errors[r.id]}
						<span class="status bad">Couldn’t start: {panel.errors[r.id]}</span>
					{:else if found || review}
						<span class="status faint">
							{found} {found === 1 ? 'finding' : 'findings'}{review?.status === 'stopped' ? ' · stopped' : ''}{isTicked(r) ? ' · runs again, replacing them' : ''}
						</span>
					{/if}
					{#if r.pickedBy && r.pickReason}
						<button class="why" aria-expanded={!!showWhy[r.id]} onclick={() => (showWhy[r.id] = !showWhy[r.id])}>
							Why was this picked?
						</button>
						{#if showWhy[r.id]}<span class="status faint reason">{r.pickReason}</span>{/if}
					{/if}

					{#if setup.mode === 'external' && (running || isTicked(r))}
						<span class="tell faint">After your usual review, tell your agent:</span>
						<span class="command">
							<span class="sentence">{agentInstruction(session, r)}</span>
							<button class="icon" aria-label="Copy what to tell your agent" title="Copy what to tell your agent" onclick={() => copy(r)}>
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
							aria-label="Start {nameOf(r, panel.reviewers)}"
							title={isTicked(r) ? 'Runs when you start the panel' : 'Turn on to run it when you start the panel'}
							onclick={() => (ticked[r.id] = !isTicked(r))}
						>
							<span></span>
						</button>
					{/if}
					{#if r.id !== FIRST_AGENT}
						<button class="icon remove" aria-label="Remove {nameOf(r, panel.reviewers)}" title="Remove {nameOf(r, panel.reviewers)}" onclick={() => remove(r)}>
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
			<span class="defaults">
				{#if panel.canUseDefault(defaultModel)}
					<button class="link default" onclick={() => panel.useDefault()}>Use my default panel</button>
					<span class="faint">·</span>
				{/if}
				<button class="link default" onclick={() => panel.saveAsDefault(defaultModel)}>Make this my default</button>
			</span>
		{/if}
	</div>

	<div class="actions">
		{#if toStart.length}
			<button class="btn primary big" onclick={startAndRead}>
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
	/* What "auto" added sits under it. */
	li.picked {
		padding-left: 18px;
		border-top-style: dashed;
	}
	.why {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.why:hover {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.reason {
		font-style: italic;
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
	.choices {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px 8px;
	}
	.dot {
		margin-left: -2px;
		font-size: 13px;
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
	.defaults {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
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
