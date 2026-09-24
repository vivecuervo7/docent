<script lang="ts">
	import { readOk } from '$lib/api';
	import type { ModelOption } from '$lib/types';
	import Spinner from '$lib/components/Spinner.svelte';
	import StateMark from '$lib/components/StateMark.svelte';

	// What Docent needs on this machine, each step checked live.
	interface SetupCheck {
		gh: { installed: boolean; login?: string };
		claude: { installed: boolean; version?: string };
		codex: { installed: boolean; version?: string };
		mcp: { claude: boolean; codex: boolean };
	}

	const MCP_URL = 'http://localhost:3001/mcp';
	// How each agent adds Docent's MCP server, for all your projects.
	const AGENTS = {
		claude: { name: 'Claude Code', command: `claude mcp add --scope user --transport http docent ${MCP_URL}` },
		codex: { name: 'Codex', command: `codex mcp add docent --url ${MCP_URL}` }
	} as const;
	type Agent = keyof typeof AGENTS;
	let check = $state<SetupCheck | null>(null);
	// The models available right now, by where they run.
	let sources = $state<string[] | null>(null);
	// The one chosen here, else whichever is installed.
	let picked = $state<Agent | null>(null);
	const agent = $derived<Agent>(picked ?? (check && !check.claude.installed && check.codex.installed ? 'codex' : 'claude'));
	let checking = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);

	async function recheck() {
		checking = true;
		error = null;
		try {
			const [setup, models] = await Promise.all([
				readOk<SetupCheck>(await fetch('/api/setup')),
				readOk<{ options: ModelOption[] }>(await fetch('/api/models'))
			]);
			check = setup;
			sources = [...new Set(models.options.map((o) => o.source))];
		} catch (err) {
			error = (err as Error).message;
		} finally {
			checking = false;
		}
	}
	$effect(() => {
		recheck();
	});

	function copy() {
		navigator.clipboard.writeText(AGENTS[agent].command).then(() => {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		});
	}
</script>

<svelte:head><title>Getting started · Docent</title></svelte:head>

<main>
	<a class="back faint" href="/">← Docent</a>
	<h1>Getting started</h1>
	<p class="lede">
		Docent runs on your machine. It reads pull requests and posts your reviews through GitHub’s own CLI, as you, and uses
		a model you choose for the summaries, slices and reviewers.
	</p>

	{#if error}
		<p class="bad">Couldn’t reach Docent’s backend: {error}. Is it running (<code>cd backend && npm run dev</code>)?</p>
	{/if}

	<ol>
		<li>
			<StateMark state={check?.gh.login ? 'done' : 'todo'} />
			<div class="step">
				<h2>Sign in to the GitHub CLI</h2>
				<p>Docent reads each PR and posts your review with <code>gh</code>, so it sees what you can see.</p>
				{#if !check}
					<p class="status faint">Checking…</p>
				{:else if check.gh.login}
					<p class="status ok">Signed in as {check.gh.login}.</p>
				{:else if check.gh.installed}
					<p class="status">Installed, but not signed in. Run <code>gh auth login</code>.</p>
				{:else}
					<p class="status">
						Not installed. Get it from <a href="https://cli.github.com" target="_blank" rel="noreferrer">cli.github.com</a>, then
						run <code>gh auth login</code>.
					</p>
				{/if}
			</div>
		</li>

		<li>
			<StateMark state={sources?.length ? 'done' : 'todo'} />
			<div class="step">
				<h2>Have a model available</h2>
				<p>
					Any one will do. <a href="https://code.claude.com" target="_blank" rel="noreferrer">Claude Code</a> or
					<a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">Codex</a>, installed and signed in,
					runs its models on your own login; or add an OpenAI-compatible provider, such as a local oMLX server or a LiteLLM
					proxy, in <a href="/settings">Settings</a>. Pick the model from the menu on the start page.
				</p>
				{#if !sources}
					<p class="status faint">Checking…</p>
				{:else if sources.length}
					<p class="status ok">Models available from {sources.join(' and ')}.</p>
				{:else}
					<p class="status">No models available yet. Install Claude Code or Codex, or add a provider in <a href="/settings">Settings</a>.</p>
				{/if}
			</div>
		</li>

		<li>
			<StateMark state={check?.mcp.claude || check?.mcp.codex ? 'done' : 'todo'} />
			<div class="step">
				<h2>Bring your own agent <span class="faint optional">optional</span></h2>
				<p>Your own agent can sit on a PR’s review panel beside Docent’s reviewers. Add Docent’s MCP server to it once, for all your projects.</p>
				<div class="agent-box">
					<div class="tabs" role="tablist" aria-label="Your agent">
						{#each Object.entries(AGENTS) as [key, a] (key)}
							<button role="tab" aria-selected={agent === key} class:on={agent === key} onclick={() => (picked = key as Agent)}>
								{a.name}
								{#if check?.mcp[key as Agent]}<StateMark state="done" size={13} />{/if}
							</button>
						{/each}
					</div>
				<div class="command">
					<code>{AGENTS[agent].command}</code>
					<button class="icon" aria-label="Copy the command" onclick={copy}>
						{#if copied}
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--done)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
						{:else}
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
						{/if}
					</button>
				</div>
				{#if !check}
					<p class="status faint">Checking…</p>
				{:else if check.mcp[agent]}
					<p class="status ok">Docent’s MCP server is added to {AGENTS[agent].name}.</p>
				{:else if check[agent].installed}
					<p class="status">Not added to {AGENTS[agent].name} yet.</p>
				{:else}
					<p class="status">{AGENTS[agent].name} isn’t installed.</p>
				{/if}
				<p>
					Then set a reviewer on the panel to “Your own agent” and start it. After your usual review, tell your agent the
					sentence the panel shows, and its findings land on the code as you read.
					{#if agent === 'claude'}
						In Claude Code, <code>/mcp__docent__review owner/repo#123</code> also asks it to review a PR, and
						<code>/mcp__docent__submit owner/repo#123</code> sends a review it has already done.
					{/if}
				</p>
				</div>
				<p class="faint small">Other MCP agents can connect to <code>{MCP_URL}</code>.</p>
			</div>
		</li>
	</ol>

	<div class="foot">
		<button class="btn" disabled={checking} onclick={recheck}>
			{#if checking}<Spinner size={13} />{/if} Check again
		</button>
	</div>
</main>

<style>
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 56px 24px 96px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.back {
		align-self: flex-start;
		font-size: 13.5px;
		text-decoration: none;
	}
	.back:hover {
		color: var(--text);
	}
	h1 {
		margin: 0 0 -8px;
		font-family: var(--serif);
		font-size: 38px;
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	.lede {
		margin: 0;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.6;
	}
	ol {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	li {
		display: flex;
		gap: 16px;
		padding: 20px 0;
		border-top: 1px solid var(--line);
	}
	li > :global(svg) {
		flex-shrink: 0;
		margin-top: 5px;
	}
	.step {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.optional {
		margin-left: 6px;
		font-family: var(--sans);
		font-size: 13px;
		font-weight: 400;
	}
	.step p {
		margin: 0;
		color: var(--muted);
		font-size: 14.5px;
		line-height: 1.6;
	}
	.step a {
		text-underline-offset: 3px;
	}
	.step .status {
		color: var(--text);
		font-size: 14px;
	}
	.step .status.ok {
		color: var(--done);
	}
	.agent-box {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px 16px 16px;
		border-radius: 12px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.tabs {
		display: flex;
		align-self: flex-start;
		padding: 2px;
		border-radius: 10px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.tabs button {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 14px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.tabs button.on {
		background: #ece8df;
		color: #141413;
	}
	.step p.small {
		font-size: 13px;
	}
	.command {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 8px 8px 14px;
		border-radius: 10px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.command code {
		flex-grow: 1;
		min-width: 0;
		padding: 0;
		background: none;
		overflow-x: auto;
		white-space: nowrap;
		font-size: 12.5px;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
	}
	.bad {
		margin: 0;
		color: var(--danger);
		font-size: 14px;
	}
</style>
