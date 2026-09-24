<script lang="ts">
	import { readOk } from '$lib/api';
	import Spinner from '$lib/components/Spinner.svelte';
	import StateMark from '$lib/components/StateMark.svelte';

	// Where Docent's models come from: Claude Code, and any number of
	// OpenAI-compatible providers. The model menu on the start page picks from
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
	interface Draft {
		name: string;
		baseUrl: string;
		apiKey: string;
		concurrency: number;
		clearKey: boolean;
	}

	let setup = $state<{ claudeCode: { installed: boolean; models: string[] }; providers: Provider[] } | null>(null);
	let loading = $state(false);
	// The provider being edited, or "new" for one being added.
	let editing = $state<string | null>(null);
	let draft = $state<Draft>(blank());
	let saving = $state(false);
	let formError = $state<string | null>(null);

	function blank(): Draft {
		return { name: '', baseUrl: '', apiKey: '', concurrency: 1, clearKey: false };
	}

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

	function edit(p: Provider | null) {
		formError = null;
		editing = p?.id ?? 'new';
		draft = p ? { name: p.name, baseUrl: p.baseUrl, apiKey: '', concurrency: p.concurrency, clearKey: false } : blank();
	}

	async function save() {
		saving = true;
		formError = null;
		const isNew = editing === 'new';
		const body = {
			name: draft.name,
			baseUrl: draft.baseUrl,
			concurrency: Number(draft.concurrency),
			// Blank keeps the saved key when editing.
			...(draft.clearKey ? { apiKey: null } : draft.apiKey.trim() ? { apiKey: draft.apiKey } : {})
		};
		try {
			await readOk(
				await fetch(isNew ? '/api/providers' : `/api/providers/${editing}`, {
					method: isNew ? 'POST' : 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				})
			);
			editing = null;
			await load();
		} catch (err) {
			formError = (err as Error).message;
		} finally {
			saving = false;
		}
	}

	async function remove(p: Provider) {
		if (!confirm(`Remove ${p.name}? Reviewers set to its models will use the first available model instead.`)) return;
		await fetch(`/api/providers/${p.id}`, { method: 'DELETE' });
		await load();
	}
</script>

<svelte:head><title>Settings · Docent</title></svelte:head>

{#snippet form(p: Provider | null)}
	<form
		class="form"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<label>
			<span>Name</span>
			<input bind:value={draft.name} placeholder="oMLX" required maxlength="60" />
		</label>
		<label>
			<span>Address</span>
			<input bind:value={draft.baseUrl} placeholder="http://127.0.0.1:8000/v1" required />
			<small class="faint">Up to and including <code>/v1</code>.</small>
		</label>
		<div class="field">
			<label for="provider-key">API key</label>
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
		</div>
		<label class="narrow">
			<span>Requests at once</span>
			<input type="number" min="1" max="16" bind:value={draft.concurrency} />
			<small class="faint">1 for a local server, which answers one at a time. A hosted one can take more.</small>
		</label>
		{#if formError}<p class="bad">{formError}</p>{/if}
		<div class="actions">
			<button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
			<button type="submit" class="btn primary" disabled={saving}>{#if saving}<Spinner size={13} />{/if} Save</button>
		</div>
	</form>
{/snippet}

<main>
	<a class="back faint" href="/">← Docent</a>
	<div class="head">
		<h1>Settings</h1>
		<button class="btn" disabled={loading} onclick={load}>{#if loading}<Spinner size={13} />{/if} Check again</button>
	</div>
	<p class="lede">Where Docent’s models come from. The model menu on the start page picks from whatever here is available.</p>

	<section>
		<h2>Claude Code</h2>
		{#if !setup}
			<p class="faint">Checking…</p>
		{:else}
			<div class="row">
				<StateMark state={setup.claudeCode.installed ? 'done' : 'todo'} />
				<div class="text">
					{#if setup.claudeCode.installed}
						<p>Installed. Its models ({setup.claudeCode.models.join(', ')}) run on your own login, through <code>claude -p</code> with no tools.</p>
					{:else}
						<p>
							Not installed. Install <a href="https://code.claude.com" target="_blank" rel="noreferrer">Claude Code</a> and sign
							in to use its models.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<section>
		<h2>Providers</h2>
		<p class="faint intro">OpenAI-compatible endpoints: a local server such as oMLX, or a hosted proxy such as LiteLLM.</p>
		{#if setup}
			<ul>
				{#each setup.providers as p (p.id)}
					<li>
						{#if editing === p.id}
							{@render form(p)}
						{:else}
							<div class="row">
								<StateMark state={p.error ? 'todo' : 'done'} />
								<div class="text">
									<div class="title">
										<span class="name">{p.name}</span>
										<code class="url">{p.baseUrl}</code>
									</div>
									{#if p.error}
										<p class="bad">{p.error}</p>
									{:else}
										<p class="ok">{p.models.length} {p.models.length === 1 ? 'model' : 'models'} available</p>
									{/if}
									<p class="faint meta">
										{p.concurrency} {p.concurrency === 1 ? 'request' : 'requests'} at once · {p.hasKey ? 'key saved' : 'no key'}
									</p>
								</div>
								<div class="controls">
									<button class="link" onclick={() => edit(p)}>Edit</button>
									<button class="link" onclick={() => remove(p)}>Remove</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
				{#if editing === 'new'}
					<li>{@render form(null)}</li>
				{/if}
			</ul>
			{#if editing !== 'new'}
				<button class="add" onclick={() => edit(null)}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					Add a provider
				</button>
			{/if}
		{/if}
	</section>

	<p class="faint note">Saved on this machine in <code>backend/data/settings.json</code>. Keys never go back to the browser.</p>
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
	section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 8px 0 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.intro {
		margin: 0;
		font-size: 14px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		padding: 16px 0;
		border-top: 1px solid var(--line);
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
	.text p.ok {
		color: var(--done);
		font-size: 14px;
	}
	.text p.meta {
		font-size: 13px;
		color: var(--faint);
	}
	.bad {
		margin: 0;
		color: var(--danger) !important;
		font-size: 14px;
	}
	.controls {
		flex-shrink: 0;
		display: flex;
		gap: 14px;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--faint);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.add {
		display: flex;
		align-items: center;
		gap: 8px;
		align-self: flex-start;
		padding: 12px 0 0;
		border: 0;
		border-top: 1px solid var(--line);
		width: 100%;
		background: none;
		color: var(--faint);
		font: inherit;
		font-size: 13.5px;
		cursor: pointer;
	}
	.add:hover {
		color: var(--text);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.form > label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: var(--muted);
	}
	.form input:not([type='checkbox']) {
		height: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: 9px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		outline: none;
	}
	.form input:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.form input:disabled {
		opacity: 0.5;
	}
	.narrow input {
		width: 90px;
	}
	small {
		font-size: 12.5px;
	}
	.check {
		font-size: 12.5px;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.note {
		margin: 8px 0 0;
		font-size: 13px;
	}
</style>
