<script lang="ts">
	import { readOk } from '$lib/api/client';
	import { ask } from '$lib/ui/confirm.svelte';
	import EditorModel from '$lib/features/settings/EditorModel.svelte';
	import ExternalReviewerSettings from '$lib/features/settings/ExternalReviewerSettings.svelte';
	import PersonaSettings from '$lib/features/settings/PersonaSettings.svelte';
	import RunnerConcurrency from '$lib/features/settings/RunnerConcurrency.svelte';
	import SettingsList from '$lib/features/settings/SettingsList.svelte';
	import SettingsSection from '$lib/features/settings/SettingsSection.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import StateMark from '$lib/ui/StateMark.svelte';

	// Where Docent's models come from: Claude Code, Codex, and any number of
	// OpenAI-compatible providers; personas and external reviewers. The model menu on the start page picks from
	// whatever here is available; anything wrong with a provider shows here.
	interface Provider {
		id: string;
		name: string;
		baseUrl: string;
		concurrency: number;
		hasKey: boolean;
		models: string[];
		error?: string;
	}
	interface Draft extends Record<string, unknown> {
		name: string;
		baseUrl: string;
		apiKey: string;
		concurrency: number;
		clearKey: boolean;
	}

	let setup = $state<{
		claudeCode: { installed: boolean; models: string[]; concurrency?: number };
		codex: { installed: boolean; models: string[]; concurrency?: number };
		providers: Provider[];
	} | null>(null);
	let loading = $state(false);

	const blank = (p: Provider | null): Draft =>
		p
			? { name: p.name, baseUrl: p.baseUrl, apiKey: '', concurrency: p.concurrency, clearKey: false }
			: { name: '', baseUrl: '', apiKey: '', concurrency: 1, clearKey: false };

	async function load() {
		loading = true;
		try {
			setup = await readOk(await fetch('/api/providers'));
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		load();
	});

	async function save(draft: Draft, p: Provider | null) {
		const body = {
			name: draft.name,
			baseUrl: draft.baseUrl,
			concurrency: Number(draft.concurrency),
			// Blank keeps the saved key when editing.
			...(draft.clearKey ? { apiKey: null } : draft.apiKey.trim() ? { apiKey: draft.apiKey } : {})
		};
		await readOk(
			await fetch(p ? `/api/providers/${p.id}` : '/api/providers', {
				method: p ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			})
		);
		await load();
	}

	async function remove(p: Provider) {
		if (!(await ask({ title: `Remove ${p.name}?`, body: 'Anything set to its models uses the first available model instead.', action: 'Remove' }))) return;
		await fetch(`/api/providers/${p.id}`, { method: 'DELETE' });
		await load();
	}
</script>

<svelte:head><title>Settings · Docent</title></svelte:head>

<main>
	<a class="btn back" href="/">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
		Back to your reviews
	</a>
	<div class="head">
		<h1>Settings</h1>
		<button class="btn" disabled={loading} onclick={load}>{#if loading}<Spinner size={13} />{/if} Check again</button>
	</div>
	<p class="lede">Where Docent’s models come from. The model menu on the start page picks from whatever here is available.</p>

	<SettingsSection title="Claude Code">
		{#if !setup}
			<p class="faint">Checking…</p>
		{:else}
			<div class="row">
				<StateMark state={setup.claudeCode.installed ? 'done' : 'todo'} />
				<div class="text">
					{#if setup.claudeCode.installed}
						<p>Installed. Its models ({setup.claudeCode.models.join(', ')}) run on your own login, through <code>claude -p</code> with no tools.</p>
						<RunnerConcurrency runner="claude-code" value={setup.claudeCode.concurrency ?? 10} />
					{:else}
						<p>
							Not installed. Install <a href="https://code.claude.com" target="_blank" rel="noreferrer">Claude Code</a> and sign
							in to use its models.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</SettingsSection>

	<SettingsSection title="Codex">
		{#if !setup}
			<p class="faint">Checking…</p>
		{:else}
			<div class="row">
				<StateMark state={setup.codex.installed ? 'done' : 'todo'} />
				<div class="text">
					{#if setup.codex.installed}
						<p>
							Signed in. Its models ({setup.codex.models.join(', ')}) run on your own login, through <code>codex exec</code> with its
							tools switched off. Some may be outside your plan; a call to one says so.
						</p>
						<RunnerConcurrency runner="codex" value={setup.codex.concurrency ?? 10} />
					{:else}
						<p>
							Not installed or not signed in. Install <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">Codex</a>
							and run <code>codex login</code> to use its models.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</SettingsSection>

	<SettingsSection title="Editor" intro="Groups the panel's findings and checks them against the code before they're shown.">
		<EditorModel />
	</SettingsSection>

	<SettingsSection title="Providers" intro="OpenAI-compatible endpoints: a local server such as oMLX, or a hosted proxy such as LiteLLM.">
		{#if setup}
			<SettingsList items={setup.providers} addLabel="Add a provider" {blank} {save} {remove}>
				{#snippet mark(p)}<StateMark state={p.error ? 'todo' : 'done'} />{/snippet}
				{#snippet row(p)}
					<div class="title">
						<span class="name">{p.name}</span>
						<code class="url">{p.baseUrl}</code>
					</div>
					{#if p.error}
						<p class="bad">{p.error}</p>
					{:else}
						<p class="ok">{p.models.length} {p.models.length === 1 ? 'model' : 'models'} available</p>
					{/if}
					<p class="meta">
						{p.concurrency} concurrent {p.concurrency === 1 ? 'request' : 'requests'} · {p.hasKey ? 'key saved' : 'no key'}
					</p>
				{/snippet}
				{#snippet fields(draft, p)}
					<Field label="Name"><input bind:value={draft.name} placeholder="oMLX" required maxlength="60" /></Field>
					<Field label="Address">
						<input bind:value={draft.baseUrl} placeholder="http://127.0.0.1:8000/v1" required />
						{#snippet hint()}Up to and including <code>/v1</code>.{/snippet}
					</Field>
					<Field label="API key" element="div" for="provider-key">
						<input
							id="provider-key"
							type="password"
							bind:value={draft.apiKey}
							disabled={draft.clearKey}
							placeholder={p?.hasKey ? 'Leave blank to keep the saved key' : 'Optional; a local server usually needs none'}
							autocomplete="off"
						/>
						{#if p?.hasKey}
							<label class="check"><input type="checkbox" bind:checked={draft.clearKey} /> Remove the saved key</label>
						{/if}
					</Field>
					<Field label="Concurrent requests" hint="1 for a local server, which answers one at a time. A hosted one can take more.">
						<input class="narrow" type="text" inputmode="numeric" pattern="[0-9]*" bind:value={draft.concurrency} />
					</Field>
				{/snippet}
			</SettingsList>
		{/if}
	</SettingsSection>

	<PersonaSettings />

	<ExternalReviewerSettings />

	<p class="faint note">Saved on this machine in <code>web/data/settings.json</code>. Keys never go back to the browser.</p>
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
		text-decoration: none;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: -8px;
	}
	h1 {
		margin: 0;
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
	.row {
		display: flex;
		align-items: flex-start;
		gap: 14px;
	}
	.row > :global(svg) {
		flex-shrink: 0;
		margin-top: 3px;
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.text p {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.6;
		color: var(--muted);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	.name {
		font-weight: 500;
	}
	.url {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		color: var(--faint);
		background: none;
		padding: 0;
	}
	.ok,
	.meta,
	.bad {
		margin: 0;
		line-height: 1.6;
	}
	.ok {
		color: var(--done);
		font-size: 14px;
	}
	.meta {
		color: var(--faint);
		font-size: 13px;
	}
	.bad {
		color: var(--danger);
		font-size: 14px;
	}
	.narrow {
		width: 90px;
	}
	.check {
		font-size: 12.5px;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
	}
	.note {
		margin: 8px 0 0;
		font-size: 13px;
	}
</style>
