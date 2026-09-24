<script lang="ts">
	import { page } from '$app/state';
	import { isSliceReviewed, useSession } from '$lib/session.svelte';
	import Spinner from './Spinner.svelte';
	import StateMark from './StateMark.svelte';

	// The review's stages. Wrap up and Post arrive in later steps of the rewrite.

	const session = useSession();
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);
	const onSlice = $derived(page.url.pathname.startsWith(`${base}/slices/`) || page.url.pathname === `${base}/files`);
	const onOverview = $derived(page.url.pathname === base);
	const onWrapUp = $derived(page.url.pathname === `${base}/wrap-up`);
	const onPost = $derived(page.url.pathname === `${base}/post`);
	const total = $derived(session.slices.length);
	const allRead = $derived(total > 0 && session.reviewedSlices === total);
	// Read goes to the first slice not yet reviewed.
	const readTarget = $derived(
		(session.slices.find((s) => !isSliceReviewed(s, session.reviewed)) ?? session.slices[0])?.id
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
		<a href="{base}/wrap-up" class="stage" class:current={onWrapUp} aria-current={onWrapUp ? 'page' : undefined}>
			<StateMark state={onWrapUp ? 'now' : 'todo'} />Wrap up
		</a>
		<span class="joint"></span>
		<a href="{base}/post" class="stage" class:current={onPost} aria-current={onPost ? 'page' : undefined}>
			<StateMark state={onPost ? 'now' : session.record.review?.posted ? 'done' : 'todo'} />Post
		</a>
	</nav>
	<div class="right">
		{#if session.panel.running.length}
			<a class="pill" href={base} title="See the panel on the Overview">
				<Spinner size={15} />
				<span>Panel · {session.panel.running.length} reviewing</span>
				{#if session.panel.findingCount}<span class="faint">{session.panel.findingCount} {session.panel.findingCount === 1 ? 'finding' : 'findings'}</span>{/if}
			</a>
		{/if}
	</div>
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
	.right {
		display: flex;
		justify-content: flex-end;
	}
	.pill {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 34px;
		padding: 0 14px;
		border-radius: 999px;
		background: #1d1a14;
		color: #f2d9b0;
		font-size: 13.5px;
		text-decoration: none;
	}
	.joint {
		width: 28px;
		height: 2px;
		border-radius: 1px;
		background: var(--line-2);
	}
</style>
