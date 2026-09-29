<script lang="ts">
	import { readOk } from '../../api/client';
	import { ask } from '$lib/ui/confirm.svelte';
	import Field from '$lib/ui/Field.svelte';
	import MenuSelect from '../../ui/MenuSelect.svelte';
	import SettingsList from './SettingsList.svelte';
	import SettingsSection from './SettingsSection.svelte';

	// External reviewers: your own tooling as a reviewer on the panel. Each
	// runs its prompt in an unattended Claude Code or Codex session, reading
	// the PR through Docent, and its findings come back like any reviewer's.
	interface Reviewer {
		id: string;
		name: string;
		runner: 'claude-code' | 'codex';
		command: string;
		model?: string;
		tools?: string;
	}
	interface Draft extends Record<string, unknown> {
		name: string;
		runner: 'claude-code' | 'codex';
		command: string;
		model: string;
		tools: string;
	}

	let reviewers = $state<Reviewer[] | null>(null);
	let codexModels = $state<string[]>([]);
	let always = $state<string[]>([]);

	async function load() {
		const res = await readOk<{ items: Reviewer[]; alwaysAllowed: string[] }>(await fetch('/api/external-reviewers'));
		reviewers = res.items;
		always = res.alwaysAllowed;
	}
	$effect(() => {
		load().catch(() => (reviewers = []));
		fetch('/api/providers')
			.then((res) => readOk<{ codex?: { models: string[] } }>(res))
			.then((r) => (codexModels = r.codex?.models ?? []))
			.catch(() => {});
	});

	// The models the chosen tool offers.
	const modelOptions = (runner: Draft['runner']) =>
		runner === 'codex'
			? [{ value: '', label: 'Codex’s default' }, ...codexModels.map((m) => ({ value: m, label: m }))]
			: [
					{ value: '', label: 'Claude Code’s default' },
					{ value: 'opus', label: 'opus' },
					{ value: 'sonnet', label: 'sonnet' },
					{ value: 'haiku', label: 'haiku' }
				];

	const send = (url: string, method: string, body: unknown) =>
		fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(readOk);

	// Dragged into a new order, saved as it lands.
	async function reorder(ids: string[]) {
		const byId = new Map((reviewers ?? []).map((p) => [p.id, p]));
		reviewers = ids.map((id) => byId.get(id)!);
		await send('/api/external-reviewers', 'PUT', { order: ids }).catch(load);
	}

	const blank = (p: Reviewer | null): Draft =>
		p
			? { name: p.name, runner: p.runner, command: p.command, model: p.model ?? '', tools: p.tools ?? '' }
			: { name: '', runner: 'claude-code', command: '', model: '', tools: '' };

	async function save(draft: Draft, p: Reviewer | null) {
		await send(p ? `/api/external-reviewers/${p.id}` : '/api/external-reviewers', p ? 'PUT' : 'POST', {
			name: draft.name,
			runner: draft.runner,
			command: draft.command,
			model: draft.model || null,
			tools: draft.runner === 'claude-code' ? draft.tools || null : null
		});
		await load();
	}

	async function remove(p: Reviewer) {
		if (!(await ask({ title: `Remove ${p.name}?`, body: 'Reviewers set to it will need something else to run them.', action: 'Remove' }))) return;
		await fetch(`/api/external-reviewers/${p.id}`, { method: 'DELETE' });
		await load();
	}
</script>

<SettingsSection
	title="External reviewers"
	intro="Your own review tooling as a reviewer on the panel: a prompt or skill run in an unattended Claude Code or Codex session, which reads the PR through Docent and hands its findings back."
>
	{#if reviewers}
		<SettingsList items={reviewers} addLabel="Add an external reviewer" {blank} {save} {remove} {reorder}>
			{#snippet row(p)}
				<span class="name">{p.name}</span>
				<p class="command">{p.command}</p>
				<p class="meta">
					{p.runner === 'codex' ? 'Codex' : 'Claude Code'} · {p.model ?? 'default model'}{p.tools ? ` · also allows ${p.tools}` : ''}
				</p>
			{/snippet}
			{#snippet fields(draft)}
				<Field label="Name"><input bind:value={draft.name} placeholder="thorough-reviewer" required maxlength="60" /></Field>
				<Field label="Runs in" element="div">
					<MenuSelect
						bind:value={draft.runner}
						label="Runs in"
						options={[
							{ value: 'claude-code', label: 'Claude Code' },
							{ value: 'codex', label: 'Codex' }
						]}
					/>
				</Field>
				<Field label="Prompt">
					<textarea bind:value={draft.command} rows="1" placeholder="Review {'{pr_url}'} for correctness and security issues" required
					></textarea>
					{#snippet hint()}
						A prompt or a skill, as you’d type it in Claude Code. <code>{'{pr_url}'}</code>, <code>{'{owner}'}</code>,
						<code>{'{repo}'}</code> and <code>{'{number}'}</code> are filled in. It runs unattended, so include anything it needs to
						skip questions or posting. Built-in commands like <code>/review</code> can’t hand their findings back.
					{/snippet}
				</Field>
				<Field label="Model" element="div">
					{#key draft.runner}<MenuSelect bind:value={draft.model} label="Model" options={modelOptions(draft.runner)} />{/key}
				</Field>
				{#if draft.runner === 'claude-code'}
					<Field
						label="Also allow"
						hint="Tools beyond these, which it always has: {always.join(', ')}. Anything else is refused, since nobody is there to approve it."
					>
						<input class="mono" bind:value={draft.tools} placeholder="e.g. Bash(gh pr view:*) Bash(gh pr diff:*)" />
					</Field>
				{:else}
					<p class="note">On Codex it reads the PR through Docent’s tools only, with its shell and the rest switched off.</p>
				{/if}
			{/snippet}
		</SettingsList>
	{/if}
</SettingsSection>

<style>
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
	.meta,
	.note {
		margin: 0;
		color: var(--faint);
		font-size: 13px;
	}
</style>
