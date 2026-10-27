<script lang="ts">
	import { readOk, sendJson } from '$lib/api/client';
	import Field from '$lib/ui/Field.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	// A provider's key command, checked when it's typed and on request. The
	// check runs the command on this machine and says whether it gave a key;
	// the key itself never comes back.
	let { value = $bindable() }: { value: string } = $props();

	type Check = { state: 'found' } | { state: 'missing' | 'failed'; message: string };
	let result = $state<Check | null>(null);
	let checking = $state(false);
	let checkedFor = '';

	async function check() {
		const command = value.trim();
		if (!command) {
			result = null;
			return;
		}
		checkedFor = command;
		checking = true;
		try {
			const outcome: Check = await readOk(await sendJson('/api/providers/key-check', { command }));
			// A reply for a command that's since been changed is for no one.
			if (checkedFor === command) result = outcome;
		} catch (err) {
			if (checkedFor === command) result = { state: 'failed', message: (err as Error).message };
		} finally {
			if (checkedFor === command) checking = false;
		}
	}

	// Where the macOS Keychain lookup reads from, for the line that stores a key there.
	const service = $derived(value.match(/^\s*security\s+find-generic-password\b.*?\s-s\s+("[^"]+"|'[^']+'|\S+)/)?.[1]);
</script>

<Field label="Key command">
	<input
		class="mono"
		bind:value
		placeholder="security find-generic-password -s litellm -w"
		autocomplete="off"
		spellcheck="false"
		onblur={() => value.trim() && value.trim() !== checkedFor && check()}
	/>
	{#snippet hint()}Prints the key, so it can stay in your keychain rather than in Docent's settings. Takes the place of the key below.{/snippet}
</Field>
{#if value.trim()}
	<div class="status">
		{#if checking}
			<p class="faint"><Spinner size={12} /> Checking…</p>
		{:else if result?.state === 'found'}
			<p class="ok">Found a key.</p>
		{:else if result}
			<p class="bad">{result.message}</p>
			{#if result.state === 'missing' && service}
				<p class="faint">Store it by running this in a terminal. It asks for the key without showing it.</p>
				<code>security add-generic-password -a "$USER" -s {service} -w</code>
			{:else if result.state === 'missing'}
				<p class="faint">Store the key where the command reads it from, then check again.</p>
			{/if}
		{/if}
		<button type="button" class="btn" disabled={checking} onclick={check}>Check again</button>
	</div>
{/if}

<style>
	.status {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	p {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
	}
	.ok {
		color: var(--done);
	}
	.bad {
		color: var(--danger);
	}
	.faint {
		color: var(--faint);
	}
	code {
		font-size: 12.5px;
		user-select: all;
	}
</style>
