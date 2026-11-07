<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import { useSession } from '$lib/session/session.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { fileTree, treeOrder, type TreeNode } from './fileTree';

	// The files a slice changes, or the PR's, as a tree: each ticked once its
	// hunks here are reviewed, the one being read picked out, a dot where
	// there's something new to read, and a click bringing a file into view.
	let { keys, slice }: { keys: string[]; slice?: string } = $props();

	const session = useSession();

	const byFile = $derived.by(() => {
		const out = new Map<string, string[]>();
		for (const key of keys) {
			const path = key.slice(0, key.lastIndexOf('#'));
			out.set(path, [...(out.get(path) ?? []), key]);
		}
		return out;
	});
	const tree = $derived(fileTree([...byFile.keys()]));
	const statusOf = $derived(new Map(session.files.map((f) => [f.filename, f.status])));
	const isReviewed = (path: string) => (byFile.get(path) ?? []).every((k) => session.reviewed[k]);
	const unreadIn = (path: string) => session.unreadInFile(path, slice);
	// A folder shows what's new inside it only while closed, as open, its files say.
	const unreadUnder = (node: TreeNode) => treeOrder([node]).reduce((n, path) => n + unreadIn(path), 0);

	const closed = new SvelteSet<string>();

	// The file being read: the last whose header has scrolled up past the
	// top of the page. A file clicked stays picked out until you scroll
	// yourself, as the scroll to it would pick out another.
	let current = $state<string | null>(null);
	let clicked = false;
	$effect(() => {
		let frame = 0;
		const spy = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				if (clicked) return;
				const sections = [...document.querySelectorAll<HTMLElement>('section.file[data-path]')].filter((s) => byFile.has(s.dataset.path!));
				const past = sections.filter((s) => s.getBoundingClientRect().top <= 140);
				current = (past.at(-1) ?? sections[0])?.dataset.path ?? null;
			});
		};
		const release = () => (clicked = false);
		spy();
		window.addEventListener('scroll', spy, { passive: true });
		window.addEventListener('resize', spy);
		for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(event, release, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', spy);
			window.removeEventListener('resize', spy);
			for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.removeEventListener(event, release);
		};
	});

	function show(path: string) {
		current = path;
		clicked = true;
		session.revealingFile = path;
	}

	const STATUS: Record<string, string> = { added: 'Added', removed: 'Deleted', renamed: 'Renamed' };
</script>

{#snippet dot(unread: number)}
	{#if unread}<span class="unread" title="{unread} new to read" aria-label="{unread} new to read"></span>{/if}
{/snippet}

{#snippet nodes(list: TreeNode[], depth: number)}
	<!-- A PR can replace a file with a folder of the same path: both are listed. -->
	{#each list as node (`${node.type}:${node.path}`)}
		{#if node.type === 'dir'}
			{@const open = !closed.has(node.path)}
			<li>
				<button
					class="row dir"
					style:--depth={depth}
					aria-expanded={open}
					title={node.path}
					onclick={() => (open ? closed.add(node.path) : closed.delete(node.path))}
				>
					<Icon name="chevron" size={12} turned={open} />
					<span class="name">{node.name}</span>
					{#if !open}{@render dot(unreadUnder(node))}{/if}
				</button>
				{#if open}<ul>{@render nodes(node.children, depth + 1)}</ul>{/if}
			</li>
		{:else}
			{@const status = statusOf.get(node.path)}
			{@const done = isReviewed(node.path)}
			<li>
				<button
					class="row file {status ?? ''}"
					class:current={node.path === current}
					class:done
					style:--depth={depth}
					aria-current={node.path === current ? 'true' : undefined}
					title="{node.path}{status && STATUS[status] ? ` · ${STATUS[status]}` : ''}{done ? ' · Reviewed' : ''}"
					onclick={() => show(node.path)}
				>
					<span class="tick" aria-label={done ? 'Reviewed' : undefined}>
						{#if done}<svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true"
								><path d="M4 9.3l3.3 3.3 6.7-7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg
							>{/if}
					</span>
					<span class="name">{node.name}</span>
					{@render dot(unreadIn(node.path))}
				</button>
			</li>
		{/if}
	{/each}
{/snippet}

<ul class="tree" aria-label="Files">{@render nodes(tree, 0)}</ul>

<style>
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/* Sits under the title of the slice it belongs to, past its mark. */
	.tree {
		padding: 4px 0 8px 24px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		padding: 3px 8px 3px calc(8px + var(--depth) * 12px);
		border: 0;
		border-radius: var(--radius-md);
		background: none;
		color: var(--faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.4;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		color: var(--text);
	}
	.dir :global(svg) {
		flex-shrink: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file {
		color: var(--muted);
	}
	.file.added .name {
		color: var(--plus-dull);
	}
	.file.removed .name {
		color: var(--minus-dull);
		text-decoration: line-through;
	}
	.file.done .name {
		opacity: 0.6;
	}
	.file.current {
		background: var(--surface-2);
		color: var(--text);
	}
	.file.current .name {
		opacity: 1;
	}
	/* Something new to read in the file: the slice rail's dot, at the row's end. */
	.unread {
		flex-shrink: 0;
		width: 6px;
		height: 6px;
		margin-left: auto;
		border-radius: var(--radius-full);
		background: var(--you);
	}
	/* Lines a file's name up under its folder's, past the folder's chevron. */
	.tick {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 12px;
		height: 12px;
		color: var(--done);
	}
</style>
