<script lang="ts">
	import { useSession } from '$lib/session.svelte';

	// How the diffs are shown. Kept in this browser.
	const session = useSession();
	let open = $state(false);

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.view')) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});
</script>

<div class="view">
	<button class="btn" aria-haspopup="true" aria-expanded={open} onclick={() => (open = !open)}>
		View
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
	</button>
	{#if open}
		<div class="menu">
			<label>
				<input type="checkbox" checked={session.hideWhitespace} onchange={(e) => session.setHideWhitespace(e.currentTarget.checked)} />
				<span>Hide whitespace changes</span>
			</label>
			<label>
				<input type="checkbox" checked={session.foldSummaries} onchange={(e) => session.setFoldSummaries(e.currentTarget.checked)} />
				<span>
					Fold summarised code
					<small class="faint">Code a note has summarised shows as its summary until opened.</small>
				</span>
			</label>
			<label>
				<input type="checkbox" checked={session.autoReviewTests} onchange={(e) => session.setAutoReviewTests(e.currentTarget.checked)} />
				<span>
					Review tests automatically
					<small class="faint">A test file whose note says what it tests counts as reviewed.</small>
				</span>
			</label>
		</div>
	{/if}
</div>

<style>
	.view {
		position: relative;
	}
	.menu {
		position: absolute;
		z-index: 25;
		top: calc(100% + 6px);
		right: 0;
		width: 300px;
		padding: 8px;
		border-radius: 12px;
		background: var(--surface-2);
		box-shadow:
			0 0 0 1px var(--line-2),
			0 24px 60px -20px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 9px 8px;
		border-radius: 8px;
		font-size: 14px;
		cursor: pointer;
	}
	label:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	input {
		margin: 2px 0 0;
		accent-color: #e8e6e1;
	}
	span {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	small {
		font-size: 12.5px;
		line-height: 1.4;
	}
</style>
