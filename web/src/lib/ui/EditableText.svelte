<script lang="ts">
	import NoteText from './NoteText.svelte';

	// Text shown as it will read on GitHub, reworded in place: Done keeps the
	// change, Cancel or Escape puts it back. The edit button is rendered by
	// the caller, where its header wants it, through `editing`.
	let {
		value,
		placeholder,
		readOnly = false,
		editing = $bindable(),
		onchange
	}: {
		value: string;
		placeholder: string;
		readOnly?: boolean;
		editing?: boolean | undefined;
		onchange: (value: string) => void;
	} = $props();

	let draft = $state('');
	let field = $state<HTMLTextAreaElement | null>(null);

	$effect(() => {
		if (editing && !readOnly) {
			draft = value;
			requestAnimationFrame(() => field?.focus());
		}
	});

	function done() {
		onchange(draft);
		editing = false;
	}
</script>

{#if editing && !readOnly}
	<div class="edit">
		<textarea bind:this={field} bind:value={draft} {placeholder} onkeydown={(e) => e.key === 'Escape' && (editing = false)}></textarea>
		<div class="actions">
			<button class="btn" onclick={() => (editing = false)}>Cancel</button>
			<button class="btn primary" onclick={done}>Done</button>
		</div>
	</div>
{:else if value.trim()}
	<div class="text"><NoteText text={value} /></div>
{:else}
	<p class="placeholder">{placeholder}</p>
{/if}

<style>
	.text {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 14.5px;
		line-height: 1.6;
	}
	.placeholder {
		margin: 0;
		color: var(--faint);
		font-size: 14px;
		font-style: italic;
	}
	.edit {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		min-height: 96px;
		resize: none;
		field-sizing: content;
		padding: 10px 12px;
		border: 0;
		border-radius: 10px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font-family: var(--mono);
		font-size: 13px;
		line-height: 1.6;
		outline: none;
	}
	textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
