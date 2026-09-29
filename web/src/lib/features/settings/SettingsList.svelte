<script lang="ts" generics="T extends { id: string; name: string }, D extends Record<string, unknown>">
	import type { Snippet } from 'svelte';
	import { Reorder } from '$lib/ui/reorder.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	// A list kept in settings - providers, personas, external reviewers -
	// each row changed in place: Edit opens its form where it sits, and the
	// add button opens a blank one at the end. With `reorder`, rows can be
	// dragged into a new order by their grip, or moved with Alt+↑/↓.
	let {
		items,
		addLabel,
		blank,
		save,
		remove,
		reorder,
		row,
		mark,
		fields,
		first
	}: {
		items: T[];
		addLabel: string;
		// The form's starting values: an item's, or a new one's.
		blank: (item: T | null) => D;
		// Saves the form, `item` being null for a new one; throws to show why not.
		save: (draft: D, item: T | null) => Promise<void>;
		remove: (item: T) => Promise<void>;
		reorder?: (ids: string[]) => Promise<void>;
		row: Snippet<[T]>;
		// Shown before a row's text, such as whether it's working.
		mark?: Snippet<[T]>;
		fields: Snippet<[D, T | null]>;
		// A row before the rest that can't be changed.
		first?: Snippet;
	} = $props();

	// The item being edited, or "new" for one being added.
	let editing = $state<string | null>(null);
	let draft = $state<D>({} as D);
	let saving = $state(false);
	let formError = $state<string | null>(null);

	const order = new Reorder(
		() => items.map((i) => i.id),
		(ids) => reorder?.(ids)
	);

	function edit(item: T | null) {
		formError = null;
		editing = item?.id ?? 'new';
		draft = blank(item);
	}

	async function submit(item: T | null) {
		saving = true;
		formError = null;
		try {
			await save(draft, item);
			editing = null;
		} catch (err) {
			formError = (err as Error).message;
		} finally {
			saving = false;
		}
	}
</script>

{#snippet form(item: T | null)}
	<form
		class="form"
		onsubmit={(e) => {
			e.preventDefault();
			submit(item);
		}}
	>
		{@render fields(draft, item)}
		{#if formError}<p class="bad">{formError}</p>{/if}
		<div class="actions">
			<button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
			<button type="submit" class="btn primary" disabled={saving}>{#if saving}<Spinner size={13} />{/if} Save</button>
		</div>
	</form>
{/snippet}

<ul>
	{#if first}
		<li><div class="row"><div class="text">{@render first()}</div></div></li>
	{/if}
	{#each items as item (item.id)}
		<li
			class:movable={!!reorder && editing !== item.id}
			class:dragging={order.dragging === item.id}
			class:over={order.over === item.id && order.dragging !== item.id}
			draggable={order.armed === item.id}
			ondragstart={(e) => order.start(e, item.id)}
			ondragover={(e) => order.hover(e, item.id)}
			ondrop={(e) => order.drop(e, item.id)}
			ondragend={() => order.end()}
		>
			{#if editing === item.id}
				{@render form(item)}
			{:else}
				{#if reorder}
					<button
						class="grip"
						aria-label="Move {item.name} (Alt+↑ or ↓)"
						onpointerdown={() => order.arm(item.id)}
						onkeydown={(e) => order.key(e, item.id)}
					><svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><circle cx="3.5" cy="3" r="1.4" /><circle cx="8.5" cy="3" r="1.4" /><circle cx="3.5" cy="8" r="1.4" /><circle cx="8.5" cy="8" r="1.4" /><circle cx="3.5" cy="13" r="1.4" /><circle cx="8.5" cy="13" r="1.4" /></svg></button>
				{/if}
				<div class="row">
					{#if mark}<span class="mark">{@render mark(item)}</span>{/if}
					<div class="text">{@render row(item)}</div>
					<div class="controls">
						<button class="link" onclick={() => edit(item)}>Edit</button>
						<button class="link" onclick={() => remove(item)}>Remove</button>
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
		{addLabel}
	</button>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		padding: 16px 0;
		border-top: 1px solid var(--line);
	}
	li.movable {
		position: relative;
	}
	li.dragging {
		opacity: 0.4;
	}
	li.over {
		box-shadow: inset 0 2px 0 var(--agent);
	}
	.grip {
		position: absolute;
		top: 18px;
		left: -26px;
		display: flex;
		padding: 2px 4px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--faint);
		fill: currentColor;
		cursor: grab;
		opacity: 0;
	}
	li.movable:hover .grip,
	.grip:focus-visible {
		opacity: 1;
	}
	.grip:hover {
		color: var(--text);
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: 14px;
	}
	.mark {
		flex-shrink: 0;
		display: flex;
		margin-top: 3px;
	}
	.text {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
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
