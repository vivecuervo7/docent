<script lang="ts">
	import { readOk } from '$lib/api';
	import { ask } from '$lib/confirm.svelte';
	import MenuSelect from './MenuSelect.svelte';
	import Spinner from './Spinner.svelte';

	// Review personas: your own tooling as a reviewer on the panel. Each runs
	// its prompt in an unattended Claude Code session, reading the PR through
	// Docent, and its findings come back like any reviewer's.
	interface Persona {
		id: string;
		name: string;
		command: string;
		model?: string;
		tools?: string;
	}
	interface Draft {
		name: string;
		command: string;
		model: string;
		tools: string;
	}

	let personas = $state<Persona[] | null>(null);
	let always = $state<string[]>([]);
	let editing = $state<string | null>(null);
	let draft = $state<Draft>(blank());
	let saving = $state(false);
	let formError = $state<string | null>(null);

	function blank(): Draft {
		return { name: '', command: '', model: '', tools: '' };
	}

	async function load() {
		const res = await readOk<{ personas: Persona[]; alwaysAllowed: string[] }>(await fetch('/api/personas'));
		personas = res.personas;
		always = res.alwaysAllowed;
	}
	$effect(() => {
		load().catch(() => (personas = []));
	});

	function edit(p: Persona | null) {
		formError = null;
		editing = p?.id ?? 'new';
		draft = p ? { name: p.name, command: p.command, model: p.model ?? '', tools: p.tools ?? '' } : blank();
	}

	async function save() {
		saving = true;
		formError = null;
		const isNew = editing === 'new';
		try {
			await readOk(
				await fetch(isNew ? '/api/personas' : `/api/personas/${editing}`, {
					method: isNew ? 'POST' : 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: draft.name, command: draft.command, model: draft.model || null, tools: draft.tools || null })
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

	async function remove(p: Persona) {
		if (!(await ask({ title: `Remove ${p.name}?`, body: 'Reviewers set to it go back to the start page’s model.', action: 'Remove' }))) return;
		await fetch(`/api/personas/${p.id}`, { method: 'DELETE' });
		await load();
	}
</script>

{#snippet form(p: Persona | null)}
	<form
		class="form"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<label>
			<span>Name</span>
			<input bind:value={draft.name} placeholder="thorough-reviewer" required maxlength="60" />
		</label>
		<label>
			<span>Prompt</span>
			<textarea bind:value={draft.command} rows="3" placeholder="Review {'{pr_url}'} for correctness and security issues" required></textarea>
			<small class="faint">
				A prompt or a skill, as you’d type it in Claude Code. <code>{'{pr_url}'}</code>, <code>{'{owner}'}</code>,
				<code>{'{repo}'}</code> and <code>{'{number}'}</code> are filled in. It runs unattended, so include anything it needs to
				skip questions or posting. Built-in commands like <code>/review</code> can’t hand their findings back.
			</small>
		</label>
		<div class="field">
			<span>Model</span>
			<MenuSelect
				bind:value={draft.model}
				label="Model"
				options={[
					{ value: '', label: 'Claude Code’s default' },
					{ value: 'opus', label: 'opus' },
					{ value: 'sonnet', label: 'sonnet' },
					{ value: 'haiku', label: 'haiku' }
				]}
			/>
		</div>
		<label>
			<span>Also allow</span>
			<input class="mono" bind:value={draft.tools} placeholder="e.g. Bash(gh pr view:*) Bash(gh pr diff:*)" />
			<small class="faint">
				Tools beyond these, which it always has: {always.join(', ')}. Anything else is refused, since nobody is there to
				approve it.
			</small>
		</label>
		{#if formError}<p class="bad">{formError}</p>{/if}
		<div class="actions">
			<button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
			<button type="submit" class="btn primary" disabled={saving}>{#if saving}<Spinner size={13} />{/if} Save</button>
		</div>
	</form>
{/snippet}

<section>
	<h2>Personas</h2>
	<p class="faint intro">
		Your own review tooling as a reviewer on the panel: a prompt or skill run in an unattended Claude Code session, which
		reads the PR through Docent and hands its findings back.
	</p>
	{#if personas}
		<ul>
			{#each personas as p (p.id)}
				<li>
					{#if editing === p.id}
						{@render form(p)}
					{:else}
						<div class="row">
							<div class="text">
								<span class="name">{p.name}</span>
								<p class="command">{p.command}</p>
								<p class="faint meta">{p.model ?? 'Claude Code’s default model'}{p.tools ? ` · also allows ${p.tools}` : ''}</p>
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
				Add a persona
			</button>
		{/if}
	{/if}
</section>

<style>
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
		line-height: 1.6;
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
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.name {
		font-weight: 500;
		color: var(--agent-text);
	}
	.command {
		margin: 0;
		color: var(--muted);
		font-size: 13.5px;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		margin: 0;
		font-size: 13px;
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
	.form input,
	.form textarea {
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
	.form input.mono {
		font-family: var(--mono);
		font-size: 13px;
	}
	.form textarea {
		height: auto;
		min-height: 76px;
		padding: 9px 12px;
		resize: none;
		field-sizing: content;
		line-height: 1.5;
	}
	.form input:focus,
	.form textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.field {
		align-items: flex-start;
	}
	small {
		font-size: 12.5px;
		line-height: 1.5;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.bad {
		margin: 0;
		color: var(--danger);
		font-size: 14px;
	}
</style>
