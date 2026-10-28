<script lang="ts">
	import { useSession } from '$lib/session/session.svelte';
	import { timeAgo } from '$lib/ui/format';

	// The reviews on GitHub this round's review reads as already said, all of
	// them unless one's unticked: its body and comments are then left out, for
	// the panel, its editor and preparing your review alike. A review that
	// lands later is included, as the rest are.
	const session = useSession();
	const reviews = $derived(session.github?.reviews ?? []);
	const leftOut = $derived(session.record.leftOutReviews ?? []);
	const included = $derived(reviews.filter((r) => !leftOut.includes(r.id)).length);
	let open = $state(false);

	const VERDICTS: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'commented', DISMISSED: 'dismissed' };

	function toggle(id: string, include: boolean) {
		session
			.update((r) => {
				const rest = (r.leftOutReviews ?? []).filter((x) => x !== id);
				if (include) {
					if (rest.length) r.leftOutReviews = rest;
					else delete r.leftOutReviews;
				} else r.leftOutReviews = [...rest, id];
			})
			.catch(() => {});
	}
</script>

{#if reviews.length}
	<div class="include">
		<button class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={open ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
			Include these reviews
			<span class="count">{included === reviews.length ? `all ${reviews.length}` : `${included} of ${reviews.length}`}</span>
		</button>
		{#if open}
			<ul>
				{#each reviews as r (r.id)}
					<li>
						<label>
							<input type="checkbox" checked={!leftOut.includes(r.id)} onchange={(e) => toggle(r.id, e.currentTarget.checked)} />
							<span class="who">{r.author}</span>
							<span class="faint">
								{VERDICTS[r.state] ?? r.state.toLowerCase()} · {timeAgo(Date.parse(r.createdAt))}{r.comments ? ` · ${r.comments} ${r.comments === 1 ? 'comment' : 'comments'}` : ''}
							</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.include {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid var(--popover-line);
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--agent-text);
		font: inherit;
		font-size: 13.5px;
		cursor: pointer;
	}
	.count {
		color: var(--faint);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 0 21px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	label {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 13px;
		cursor: pointer;
	}
	input {
		accent-color: var(--agent);
		transform: translateY(2px);
	}
	.who {
		color: var(--text);
	}
</style>
