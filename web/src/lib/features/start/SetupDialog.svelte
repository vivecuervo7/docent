<script lang="ts">
	import Dialog from '$lib/ui/Dialog.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import StateMark from '$lib/ui/StateMark.svelte';
	import type { StartPage } from './startPage.svelte';

	// The first visit's guide, for someone missing what Docent needs: the
	// GitHub CLI signed in, and a model. Each is checked live, with what to do
	// about it; everything else is optional and left to Getting started.
	let { page, onclose }: { page: StartPage; onclose: () => void } = $props();

	let checking = $state(false);
	async function recheck() {
		checking = true;
		await page.recheck();
		checking = false;
	}
</script>

<Dialog label="Before your first review" width={560} {onclose}>
	<h2>Before your first review</h2>
	<p class="lede">Docent needs two things on this machine. Everything else is optional.</p>
	<ol>
		<li>
			<StateMark state={page.gh?.login ? 'done' : 'todo'} />
			<div class="step">
				<h3>The GitHub CLI, signed in</h3>
				{#if page.gh?.login}
					<p class="ok">Signed in as {page.gh.login}.</p>
				{:else if page.gh?.installed}
					<p>Installed, but not signed in. Run <code>gh auth login</code>.</p>
				{:else}
					<p>
						Docent reads PRs and posts your reviews through it, as you. Install it from
						<a href="https://cli.github.com" target="_blank" rel="noreferrer">cli.github.com</a>, then run <code>gh auth login</code>.
					</p>
				{/if}
			</div>
		</li>
		<li>
			<StateMark state={page.modelSources?.length ? 'done' : 'todo'} />
			<div class="step">
				<h3>A model</h3>
				{#if page.modelSources?.length}
					<p class="ok">Available from {page.modelSources.join(' and ')}.</p>
				{:else}
					<p>
						Install <a href="https://code.claude.com" target="_blank" rel="noreferrer">Claude Code</a> or
						<a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">Codex</a> and sign in, or add an
						OpenAI-compatible provider, such as a local oMLX server, in <a href="/settings">Settings</a>.
					</p>
				{/if}
			</div>
		</li>
	</ol>
	<p class="extras">
		Your own agent over MCP, external reviewers and personas can come later; <a href="/getting-started">Getting started</a>
		covers them.
	</p>
	<div class="actions">
		<button class="btn" disabled={checking} onclick={recheck}>{#if checking}<Spinner size={13} />{/if} Check again</button>
		<button class="btn primary" onclick={onclose}>{page.ready ? 'Start reviewing' : 'Got it'}</button>
	</div>
</Dialog>

<style>
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 24px;
		font-weight: 500;
	}
	.lede {
		margin: -6px 0 0;
		color: var(--muted);
		font-size: 14.5px;
		line-height: 1.6;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	li {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px 0;
		border-top: 1px solid var(--line);
	}
	li > :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.step {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
	}
	.step p {
		margin: 0;
		color: var(--muted);
		font-size: 14px;
		line-height: 1.6;
	}
	.step p.ok {
		color: var(--done);
	}
	.extras {
		margin: 0;
		padding-top: 14px;
		border-top: 1px solid var(--line);
		color: var(--faint);
		font-size: 13.5px;
		line-height: 1.6;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
