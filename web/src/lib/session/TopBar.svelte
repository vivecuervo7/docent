<script lang="ts">
	import InlineText from '../ui/InlineText.svelte';
	import { page } from '$app/state';
	import { isSliceReviewed, useSession } from '$lib/session/session.svelte';
	import PanelChip from '../features/panel/PanelChip.svelte';
	import RoundChip from '../features/rounds/RoundChip.svelte';
	import AccountMenu from '../ui/AccountMenu.svelte';
	import StateMark from '../ui/StateMark.svelte';

	// The review's stages.

	const session = useSession();
	const base = $derived(session.base);
	const onSlice = $derived(page.url.pathname.startsWith(`${base}/slices/`) || page.url.pathname === `${base}/files`);
	const onOverview = $derived(page.url.pathname === base);
	const onWrapUp = $derived(page.url.pathname === `${base}/wrap-up`);
	const onPost = $derived(page.url.pathname === `${base}/post`);
	const total = $derived(session.slices.length);
	const allRead = $derived(total > 0 && session.reviewedSlices === total);
	// Wrap up is done once the PR is read and your comments are drafted from
	// your threads as they stand; the panel's findings already have a choice,
	// its or yours.
	const wrappedUp = $derived(allRead && (!session.yours.threads.length || (!!session.record.feedback.yours && !session.yours.threadsChanged)));
	// Read goes to the first slice not yet reviewed.
	const readTarget = $derived((session.slices.find((s) => !isSliceReviewed(s, session.reviewed)) ?? session.slices[0])?.id);
</script>

<header>
	<div class="left">
		<a class="brand" href="/">Docent</a>
		<span class="faint title" title={session.title.replaceAll('`', '')}><InlineText text={session.title} /></span>
	</div>
	<nav aria-label="Review stages">
		<a href={base} class="stage" class:current={onOverview} aria-current={onOverview ? 'page' : undefined}>
			<StateMark state={onOverview ? 'now' : 'done'} />Overview
		</a>
		<span class="joint"></span>
		{#if readTarget}
			<a href="{base}/slices/{readTarget}" class="stage" class:current={onSlice} aria-current={onSlice ? 'page' : undefined}>
				<StateMark state={onSlice ? 'now' : allRead ? 'done' : 'todo'} />Read{#if !session.switchingRound}{` ${session.reviewedSlices} of ${total}`}{/if}
			</a>
		{:else}
			<span class="stage off"><StateMark state="todo" />Read</span>
		{/if}
		<span class="joint"></span>
		<a href="{base}/wrap-up" class="stage" class:current={onWrapUp} aria-current={onWrapUp ? 'page' : undefined}>
			<StateMark state={onWrapUp ? 'now' : wrappedUp ? 'done' : 'todo'} />Wrap up
		</a>
		<span class="joint"></span>
		<a href="{base}/post" class="stage" class:current={onPost} aria-current={onPost ? 'page' : undefined}>
			<StateMark state={onPost ? 'now' : session.record.completedAt ? 'done' : 'todo'} />Post
		</a>
	</nav>
	<div class="right">
		<RoundChip />
		<PanelChip />
		<span class="account"><AccountMenu size={28} /></span>
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
		/* The stages centred when there's room; when the bar is narrow the title
		   gives way, rather than the chips running over the stages or the stages
		   over the name. */
		grid-template-columns: minmax(min-content, 1fr) auto minmax(max-content, 1fr);
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
		/* No width of its own, so the bar's narrowest is the name, not the title;
		   and no wider than about the chips opposite, so the bar stays balanced. */
		flex: 1 1 0;
		width: 0;
		min-width: 0;
		max-width: 240px;
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
		white-space: nowrap;
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
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}
	.account {
		display: flex;
		margin-left: 8px;
	}
	.joint {
		width: 28px;
		height: 2px;
		border-radius: 1px;
		background: var(--line-2);
	}
</style>
