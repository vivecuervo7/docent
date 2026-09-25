<script lang="ts">
	import { readOk } from '$lib/api';
	import { ask } from '$lib/confirm.svelte';
	import Spinner from './Spinner.svelte';

	// Personas: Docent's own reviewer with a point of view. Default is today's
	// general review; your own add instructions, like a security focus. A
	// reviewer on the panel runs a persona on whichever model it's set to.
	interface Persona {
		id: string;
		name: string;
		instructions: string;
	}

	let personas = $state<Persona[] | null>(null);
	let editing = $state<string | null>(null);
	let draft = $state({ name: '', instructions: '' });
	let saving = $state(false);
	let formError = $state<string | null>(null);

	async function load() {
		personas = (await readOk<{ items: Persona[] }>(await fetch('/api/personas'))).items;
	}
	$effect(() => {
		load().catch(() => (personas = []));
	});

	function edit(p: Persona | null) {
		formError = null;
		editing = p?.id ?? 'new';
		draft = p ? { name: p.name, instructions: p.instructions } : { name: '', instructions: '' };
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
					body: JSON.stringify(draft)
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
		if (!(await ask({ title: `Remove ${p.name}?`, body: 'Reviewers with it go back to the Default persona.', action: 'Remove' }))) return;
		await fetch(`/api/personas/${p.id}`, { method: 'DELETE' });
		await load();
	}
</script>

{#snippet form()}
	<form
		class="form"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<label>
			<span>Name</span>
			<input bind:value={draft.name} placeholder="Security" required maxlength="60" />
		</label>
		<label>
			<span>What it looks for</span>
			<textarea
				bind:value={draft.instructions}
				rows="1"
				placeholder="Injection, gaps in authorisation, secrets in code or logs, unsafe deserialisation. Ignore style."
				required
			></textarea>
			<small class="faint">Added to Docent’s reviewer’s own instructions; it raises only what falls within this.</small>
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
		Docent’s own reviewer with a point of view. On the panel, a reviewer runs a persona on whichever model it’s set to.
	</p>
	<ul>
		<li>
			<div class="row">
				<div class="text">
					<span class="name">Default</span>
					<p class="instructions">A general review: correctness, clarity, tests and risk.</p>
				</div>
			</div>
		</li>
		{#each personas ?? [] as p (p.id)}
			<li>
				{#if editing === p.id}
					{@render form()}
				{:else}
					<div class="row">
						<div class="text">
							<span class="name">{p.name}</span>
							<p class="instructions">{p.instructions}</p>
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
			<li>{@render form()}</li>
		{/if}
	</ul>
	{#if editing !== 'new'}
		<button class="add" onclick={() => edit(null)}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
			Add a persona
		</button>
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
	}
	.instructions {
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
	.form > label {
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
	.form textarea {
		height: auto;
		min-height: 36px;
		box-sizing: border-box;
		padding: 7px 12px;
		resize: vertical;
		field-sizing: content;
		line-height: 1.5;
	}
	.form input:focus,
	.form textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
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
