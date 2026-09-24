<script lang="ts">
	import { page } from '$app/state';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';
	import StateMark from './StateMark.svelte';

	// The review's stages. Wrap up and Post arrive in later steps of the rewrite.

	const session = useSession();
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	const onSlice = $derived(page.url.pathname.startsWith(`${base}/slices/`));
	const onOverview = $derived(page.url.pathname === base);
	const total = $derived(session.slices.length);
	const allRead = $derived(total > 0 && session.reviewedSlices === total);
	// Read goes to the first slice not yet reviewed.
	const readTarget = $derived(
		(session.slices.find((s) => !isSliceReviewed(s, session.record.reviewed)) ?? session.slices[0])?.id
	);
</script>

<header>
	<div class="left">
		<a class="brand" href="/">Docent</a>
		<span class="faint title">{session.title}</span>
	</div>
	<nav aria-label="Review stages">
		<a href={base} class="stage" class:current={onOverview} aria-current={onOverview ? 'page' : undefined}>
			<StateMark state={onOverview ? 'now' : 'done'} />Overview
		</a>
		<span class="joint"></span>
		{#if readTarget}
			<a href="{base}/slices/{readTarget}" class="stage" class:current={onSlice} aria-current={onSlice ? 'page' : undefined}>
				<StateMark state={onSlice ? 'now' : allRead ? 'done' : 'todo'} />Read {session.reviewedSlices} of {total}
			</a>
		{:else}
			<span class="stage off"><StateMark state="todo" />Read</span>
		{/if}
		<span class="joint"></span>
		<span class="stage off"><StateMark state="todo" />Wrap up</span>
		<span class="joint"></span>
		<span class="stage off"><StateMark state="todo" />Post</span>
	</nav>
	<div class="right"></div>
</header>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 30;
		height: 64px;
		box-sizing: border-box;
		padding: 0 28px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 24px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	.left {
		display: flex;
		align-items: baseline;
		gap: 14px;
		min-width: 0;
	}
	.brand {
		font-family: var(--serif);
		font-size: 21px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
	}
	.title {
		font-size: 13.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.stage {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--muted);
		text-decoration: none;
	}
	a.stage:hover,
	.stage.current {
		color: var(--text);
	}
	.stage.current {
		font-weight: 500;
	}
	.stage.off {
		color: var(--faint);
	}
	.joint {
		width: 28px;
		height: 2px;
		border-radius: 1px;
		background: var(--line-2);
	}
</style>
