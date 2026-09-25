<script lang="ts">
	// How many of a tool's calls Docent runs at once, changed in place.
	let { runner, value }: { runner: 'claude-code' | 'codex'; value: number } = $props();

	let current = $state(0);
	let saved = $state<'idle' | 'saving' | 'saved' | 'bad'>('idle');
	$effect(() => {
		current = value;
	});

	async function save() {
		const n = Number(current);
		if (!Number.isInteger(n) || n < 1 || n > 32) {
			saved = 'bad';
			return;
		}
		if (n === value) return;
		saved = 'saving';
		const res = await fetch(`/api/runners/${runner}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ concurrency: n })
		}).catch(() => null);
		saved = res?.ok ? 'saved' : 'bad';
	}
</script>

<label class="concurrency">
	<span>Concurrent requests</span>
	<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={current} onchange={save} aria-label="Concurrent requests" />
	{#if saved === 'saved'}<span class="faint note">Saved</span>{:else if saved === 'bad'}<span class="bad note">1 to 32</span>{/if}
</label>

<style>
	.concurrency {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--faint);
	}
	input {
		width: 44px;
		text-align: center;
		height: 30px;
		padding: 0 8px;
		border: 0;
		border-radius: 8px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 13px;
		outline: none;
	}
	input:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.note {
		font-size: 12px;
	}
	.bad {
		color: var(--danger);
	}
</style>
