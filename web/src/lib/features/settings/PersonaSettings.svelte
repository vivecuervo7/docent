<script lang="ts">
	import { readOk } from '../../api/client';
	import { ask } from '$lib/ui/confirm.svelte';
	import Field from '$lib/ui/Field.svelte';
	import SettingsList from './SettingsList.svelte';
	import SettingsSection from './SettingsSection.svelte';

	// Personas: Docent's own reviewer with a point of view. Default is today's
	// general review; your own add instructions, like a security focus. A
	// reviewer on the panel runs a persona on whichever model it's set to.
	interface Persona {
		id: string;
		name: string;
		instructions: string;
	}

	let personas = $state<Persona[] | null>(null);

	async function load() {
		personas = (await readOk<{ items: Persona[] }>(await fetch('/api/personas'))).items;
	}
	$effect(() => {
		load().catch(() => (personas = []));
	});

	const send = (url: string, method: string, body: unknown) =>
		fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(readOk);

	// Dragged into a new order, saved as it lands.
	async function reorder(ids: string[]) {
		const byId = new Map((personas ?? []).map((p) => [p.id, p]));
		personas = ids.map((id) => byId.get(id)!);
		await send('/api/personas', 'PUT', { order: ids }).catch(load);
	}

	async function save(draft: { name: string; instructions: string }, p: Persona | null) {
		await send(p ? `/api/personas/${p.id}` : '/api/personas', p ? 'PUT' : 'POST', draft);
		await load();
	}

	async function remove(p: Persona) {
		if (!(await ask({ title: `Remove ${p.name}?`, body: 'Reviewers with it go back to the general persona.', action: 'Remove' }))) return;
		await fetch(`/api/personas/${p.id}`, { method: 'DELETE' });
		await load();
	}
</script>

<SettingsSection
	title="Personas"
	intro="Docent’s own reviewer with a point of view. On the panel, a reviewer runs a persona on whichever model it’s set to."
>
	<SettingsList
		items={personas ?? []}
		addLabel="Add a persona"
		blank={(p) => ({ name: p?.name ?? '', instructions: p?.instructions ?? '' })}
		{save}
		{remove}
		{reorder}
	>
		{#snippet first()}
			<span class="name">general</span>
			<p class="instructions">Correctness, clarity, tests and risk.</p>
		{/snippet}
		{#snippet row(p)}
			<span class="name">{p.name}</span>
			<p class="instructions">{p.instructions}</p>
		{/snippet}
		{#snippet fields(draft)}
			<Field label="Name"><input bind:value={draft.name} placeholder="Security" required maxlength="60" /></Field>
			<Field label="What it looks for" hint="Added to Docent’s reviewer’s own instructions; it raises only what falls within this.">
				<textarea
					bind:value={draft.instructions}
					rows="1"
					placeholder="Injection, gaps in authorisation, secrets in code or logs, unsafe deserialisation. Ignore style."
					required
				></textarea>
			</Field>
		{/snippet}
	</SettingsList>
</SettingsSection>

<style>
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
</style>
