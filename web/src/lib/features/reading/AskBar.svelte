<script lang="ts">
	import { useSession } from '$lib/session/session.svelte';
	import type { Slice } from '$lib/types';
	import Composer, { type SendKind } from './Composer.svelte';

	// Asking about, or commenting on, more than some lines, from wherever
	// the reading's got to: the slice, the file in view, or the whole PR.
	// Lines are asked about by selecting them in the diff.
	let { slice, onslicenote }: { slice: Slice; onslicenote: () => void } = $props();

	const session = useSession();
	type Scope = 'slice' | 'file' | 'pr';
	let scope = $state<Scope>('slice');
	let choosing = $state(false);
	let draft = $state('');

	// The file nearest the top of the screen, as reading moves down.
	let fileInView = $state<string | null>(null);
	function track() {
		let current: string | null = null;
		for (const el of document.querySelectorAll<HTMLElement>('section.file[data-path]')) {
			if (el.getBoundingClientRect().top > window.innerHeight * 0.4) break;
			current = el.dataset.path ?? null;
		}
		fileInView = current ?? document.querySelector<HTMLElement>('section.file[data-path]')?.dataset.path ?? null;
	}
	$effect(() => {
		void slice.id;
		track();
	});
	$effect(() => {
		if (scope === 'file' && !fileInView) scope = 'slice';
	});

	const fileName = $derived(fileInView?.split('/').pop() ?? '');
	const label = $derived(scope === 'slice' ? 'This slice' : scope === 'file' ? fileName : 'The whole PR');

	// Where the answer lands, said once it's asked, when it isn't in view.
	let sent = $state<Scope | null>(null);
	let clear: ReturnType<typeof setTimeout> | undefined;
	function send(text: string, kind: SendKind) {
		const comment = kind === 'comment';
		if (scope === 'file' && fileInView) {
			session.revealing = session.createNote({ path: fileInView }, text, { comment });
			return;
		}
		session.createNote(scope === 'slice' ? { path: '', slice: slice.id } : { path: '' }, text, { comment });
		sent = scope;
		clearTimeout(clear);
		clear = setTimeout(() => (sent = null), 8000);
	}

	$effect(() => {
		if (!choosing) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.scopes, .scope')) choosing = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

<svelte:window onscroll={track} onresize={track} />

<div class="ask">
	{#if sent === 'slice'}
		<p class="sent">Asked. It’s in <button class="link" onclick={onslicenote}>About this slice</button>, below.</p>
	{:else if sent === 'pr'}
		<p class="sent">Asked about the whole PR. It’s on the <a href={session.base}>Overview</a>.</p>
	{/if}
	<div class="bar">
		<div class="pick">
			<button class="scope" aria-haspopup="true" aria-expanded={choosing} onclick={() => (choosing = !choosing)}>
				{label}
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
			</button>
			{#if choosing}
				<div class="scopes" role="menu">
					<button role="menuitemradio" aria-checked={scope === 'slice'} onclick={() => ((scope = 'slice'), (choosing = false))}>This slice</button>
					{#if fileInView}
						<button role="menuitemradio" aria-checked={scope === 'file'} onclick={() => ((scope = 'file'), (choosing = false))}>
							{fileName}<small class="faint">the file in view</small>
						</button>
					{/if}
					<button role="menuitemradio" aria-checked={scope === 'pr'} onclick={() => ((scope = 'pr'), (choosing = false))}>The whole PR</button>
				</div>
			{/if}
		</div>
		<div class="write">
			<Composer bind:value={draft} placeholder="Ask, or leave a comment…" onsend={send} />
		</div>
	</div>
</div>

<style>
	.ask {
		flex: 1 1 600px;
		min-width: 0;
		max-width: 600px;
		white-space: normal;
		margin-right: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sent {
		margin: 0;
		align-self: flex-start;
		padding: 6px 10px;
		border-radius: 8px;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--muted);
		font-size: 13px;
	}
	.sent a,
	.link {
		color: var(--text);
		text-underline-offset: 3px;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.bar {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px;
		border-radius: 14px;
		background: var(--surface-2);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 16px 40px -16px rgba(0, 0, 0, 0.7);
	}
	.pick {
		position: relative;
		flex: none;
	}
	.scope {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 38px;
		max-width: 200px;
		padding: 0 10px;
		border: 0;
		border-radius: 9px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.scopes {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 30;
		width: 260px;
		padding: 6px;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	.scopes button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 8px 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.scopes button:hover,
	.scopes button[aria-checked='true'] {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text);
	}
	.scopes small {
		font-size: 12px;
	}
	.write {
		flex: 1;
		min-width: 0;
	}
</style>
