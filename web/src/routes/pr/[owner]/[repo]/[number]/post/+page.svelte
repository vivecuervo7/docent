<script lang="ts">
	import Dialog from '$lib/components/Dialog.svelte';
	import EditableText from '$lib/components/EditableText.svelte';
	import FilePath from '$lib/components/FilePath.svelte';
	import FindingLines from '$lib/components/FindingLines.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { describeLines } from '$lib/post.svelte';
	import { useSession } from '$lib/session.svelte';
	import type { ReviewComment, ReviewEvent, ReviewPayload } from '$lib/types';

	// The last look before posting: the review laid out the way the author
	// will see it on GitHub, the review's own text first and the comments on
	// lines beneath it, every piece reworded in place.
	const session = useSession();
	const post = session.post;
	const draft = $derived(post.draft);
	const readOnly = $derived(!!draft?.posted);

	const EVENTS: { event: ReviewEvent; label: string; verb: string }[] = [
		{ event: 'COMMENT', label: 'Comment', verb: 'commented' },
		{ event: 'APPROVE', label: 'Approve', verb: 'approved these changes' },
		{ event: 'REQUEST_CHANGES', label: 'Request changes', verb: 'requested changes' }
	];
	const event = $derived(EVENTS.find((e) => e.event === draft?.event) ?? EVENTS[0]);
	const isOwnPr = $derived(!!post.people && post.people.viewer === post.people.author);

	$effect(() => post.loadPeople());

	const inline = $derived(draft?.comments.filter((c) => post.isInline(c)) ?? []);
	const inBody = $derived(draft?.comments.filter((c) => !post.isInline(c)) ?? []);
	const counts = $derived({
		yours: post.candidates.filter((c) => c.source === 'yours').length,
		panel: post.candidates.filter((c) => c.source !== 'yours').length
	});
	const byId = $derived(new Map(post.candidates.map((c) => [c.item.id, c.item])));

	let editing = $state<Record<string, boolean>>({});
	let confirming = $state<ReviewPayload | null>(null);

	// What's changed in Wrap up since the review was prepared, in words.
	const staleChange = $derived.by(() => {
		if (!draft) return '';
		const now = post.candidates.map((c) => c.item.id);
		const added = now.filter((id) => !draft.basedOn.includes(id)).length;
		const dropped = draft.basedOn.filter((id) => !now.includes(id)).length;
		const parts = [
			added && `${added} more ${added === 1 ? 'comment or finding has' : 'comments or findings have'} been kept`,
			dropped && `${dropped} ${dropped === 1 ? 'comment or finding is' : 'comments or findings are'} no longer kept`
		].filter(Boolean);
		return parts.join(' and ') || 'what’s kept in Wrap up has changed';
	});
	let posting = $state(false);
	let postError = $state<string | null>(null);

	// What will go out: comments on lines, comments in the review's text, and
	// the review's own words.
	function tally(onLines: number, inText: number, summary: boolean) {
		const parts = [
			onLines > 0 && `${onLines} ${onLines === 1 ? 'comment' : 'comments'} on lines`,
			inText > 0 && `${inText} in the review’s text`,
			summary && 'a review body'
		].filter((p): p is string => !!p);
		if (!parts.length) return 'nothing to post yet';
		return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
	}
	const hasSummary = $derived(!!draft?.summary.trim() && !draft.summaryLeftOut);
	const keptInline = $derived(inline.filter((c) => c.included).length);
	const keptInBody = $derived(inBody.filter((c) => c.included).length);

	async function review() {
		postError = null;
		try {
			confirming = await post.preview();
		} catch (err) {
			postError = (err as Error).message;
		}
	}

	async function send() {
		posting = true;
		postError = null;
		try {
			await post.post();
			confirming = null;
		} catch (err) {
			postError = (err as Error).message;
		} finally {
			posting = false;
		}
	}
</script>

{#snippet editButton(id: string)}
	{#if !readOnly && !editing[id]}
		<button class="icon" aria-label="Edit" title="Edit" onclick={() => (editing[id] = true)}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
		</button>
	{/if}
{/snippet}

{#snippet leaveOut(comment: ReviewComment)}
	{#if !readOnly}
		<button class="link" onclick={() => post.setComment(comment.id, { included: !comment.included })}>
			{comment.included ? 'Leave out' : 'Include'}
		</button>
	{/if}
{/snippet}

<main>
	<div class="head">
		<div>
			<h1>Post</h1>
			<p class="lede">A last look at the review as it will appear on the PR. Reword anything before it goes out.</p>
		</div>
		{#if draft && !(post.stale && !readOnly)}
			{#if post.prepareStatus.pending}
				<span class="faint pending"><Spinner size={13} /> Preparing…</span>
			{:else if readOnly}
				<button class="btn" onclick={() => post.startOver()}>Start a new review</button>
			{:else}
				<button class="btn" onclick={() => post.prepare()}>Prepare again</button>
			{/if}
		{/if}
	</div>

	{#if post.prepareStatus.error}
		<p class="bad">Couldn’t prepare the review: {post.prepareStatus.error}</p>
	{/if}

	{#if !draft}
		<section class="prompt">
			<p>
				{#if post.candidates.length}
					Put the {counts.yours} {counts.yours === 1 ? 'comment' : 'comments'} of yours and {counts.panel}
					{counts.panel === 1 ? 'finding' : 'findings'} from the panel you’ve kept into one review. Comments making
					the same point are merged, and anything already said on the PR is set aside.
				{:else}
					Nothing is kept in Wrap up. You can still prepare a review to approve, or to post a summary on its own.
				{/if}
			</p>
			<div>
				{#if post.prepareStatus.pending}
					<span class="faint pending"><Spinner size={13} /> Preparing…</span>
				{:else}
					<button class="btn primary big" onclick={() => post.prepare()}>Prepare the review</button>
				{/if}
			</div>
		</section>
	{:else}
		{#if draft.posted}
			<div class="posted" role="status">
				<span class="grow">Posted {new Date(draft.posted.at).toLocaleString()}.</span>
				<a href={draft.posted.url} target="_blank" rel="noreferrer">View on GitHub</a>
			</div>
		{:else if post.stale}
			<div class="stale" role="status">
				<div class="grow">
					<strong>This review is out of date.</strong>
					Since it was prepared, {staleChange}. Preparing it again takes that into account, and replaces this draft, including
					any edits you’ve made to it.
				</div>
				{#if post.prepareStatus.pending}
					<span class="faint pending"><Spinner size={13} /> Preparing…</span>
				{:else}
					<button class="btn primary" onclick={() => post.prepare()}>Prepare again</button>
				{/if}
			</div>
		{/if}

		<div class="review">
			<section class="card">
				<header>
					<span class="viewer">{post.people?.viewer ?? 'You'}</span>
					<span class="grow faint">{event.verb}</span>
					{#if !readOnly && draft.summary.trim()}
						<button class="link" onclick={() => post.change((d) => ({ ...d, summaryLeftOut: !d.summaryLeftOut }))}>
							{draft.summaryLeftOut ? 'Include' : 'Leave out'}
						</button>
					{/if}
					{@render editButton('summary')}
				</header>
				<div class="card-body">
					<div class="summary" class:out={draft.summaryLeftOut}>
					<EditableText
						bind:editing={editing.summary}
						value={draft.summary}
						{readOnly}
						placeholder="No review body. Add one to say something about the PR overall."
						onchange={(summary) => post.change((d) => ({ ...d, summary }))}
					/>
					</div>
					{#each inBody as comment (comment.id)}
						<div class="in-body" class:out={!comment.included}>
							<div class="row-head">
								<span class="where grow">{#if comment.path}<FilePath path={comment.path} lines={comment.start && comment.end ? describeLines(comment.start, comment.end) : undefined} />{:else}About the PR as a whole{/if}</span>
								{@render leaveOut(comment)}
								{@render editButton(comment.id)}
							</div>
							<EditableText
								bind:editing={editing[comment.id]}
								value={comment.body}
								{readOnly}
								placeholder="Empty comments aren’t posted."
								onchange={(body) => post.setComment(comment.id, { body })}
							/>
						</div>
					{/each}
				</div>
			</section>

			{#if inline.length}
				<div class="thread">
					{#each inline as comment (comment.id)}
						<article class="card" class:out={!comment.included}>
							<header>
								<span class="where grow">{#if comment.path}<FilePath path={comment.path} lines={comment.start && comment.end ? describeLines(comment.start, comment.end) : undefined} />{:else}About the PR as a whole{/if}</span>
								{@render leaveOut(comment)}
								{@render editButton(comment.id)}
							</header>
							{#if comment.path && comment.start && comment.end}
								<div class="lines"><FindingLines mark={{ path: comment.path, start: comment.start, end: comment.end }} /></div>
							{/if}
							<div class="card-body">
								<EditableText
									bind:editing={editing[comment.id]}
									value={comment.body}
									{readOnly}
									placeholder="Empty comments aren’t posted."
									onchange={(body) => post.setComment(comment.id, { body })}
								/>
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</div>

		{#if draft.dropped.length}
			<section>
				<button class="fold-head" aria-expanded={post.showDropped} onclick={() => (post.showDropped = !post.showDropped)}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={post.showDropped ? 'rotate(90deg)' : ''}><path d="M9 6l6 6-6 6" /></svg>
					Already said on the PR <span class="count">{draft.dropped.length}</span>
				</button>
				{#if post.showDropped}
					<ul class="dropped">
						{#each draft.dropped as dropped, i (i)}
							<li>
								{#each dropped.from as id (id)}
									{@const item = byId.get(id)}
									{#if item}<div class="said"><EditableText value={item.body} readOnly placeholder="" onchange={() => {}} /></div>{/if}
								{/each}
								<span class="faint">{dropped.reason}</span>
								{#if !readOnly}<button class="link" onclick={() => post.restoreDropped(i)}>Include anyway</button>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		{#if !readOnly}
			<section class="send">
					<div class="events" role="group" aria-label="Outcome">
						{#each EVENTS as option (option.event)}
							{@const unavailable = isOwnPr && option.event !== 'COMMENT'}
							<button
								class:on={draft.event === option.event}
								aria-pressed={draft.event === option.event}
								disabled={unavailable}
								title={unavailable ? 'GitHub doesn’t let you approve or request changes on your own PR.' : undefined}
								onclick={() => post.change((d) => ({ ...d, event: option.event }))}>{option.label}</button
							>
						{/each}
					</div>
					{#if postError && !confirming}<p class="bad">Couldn’t post the review: {postError}</p>{/if}
					<div class="actions">
						<span class="faint grow">{tally(keptInline, keptInBody, hasSummary)}</span>
						<button class="btn primary big" onclick={review}>Post review</button>
					</div>
			</section>
		{/if}
	{/if}
</main>

{#if confirming && draft}
	<Dialog label="Post this review?" width={520} onclose={() => !posting && (confirming = null)}>
		<h2>Post this review?</h2>
		<p class="confirm-text">
			To {session.ref.owner}/{session.ref.repo}#{session.ref.number}{#if post.people}{' '}as {post.people.viewer}{/if}:
			{EVENTS.find((e) => e.event === confirming?.event)?.label}, with {tally(confirming.comments.length, keptInBody, hasSummary)}.
			It’s visible to everyone on the PR.
		</p>
		{#if post.stale}
			<p class="confirm-stale">This review is out of date: since it was prepared, {staleChange}. It will post as it is now.</p>
		{/if}
		{#if postError}<p class="bad">Couldn’t post the review: {postError}</p>{/if}
		<div class="actions">
			<button class="btn" disabled={posting} onclick={() => (confirming = null)}>Back</button>
			<button class="btn primary big" disabled={posting} onclick={send}>
				{#if posting}<Spinner size={13} />{/if} Post to GitHub
			</button>
		</div>
	</Dialog>
{/if}

<style>
	main {
		max-width: 860px;
		margin: 0 auto;
		padding: 56px 24px 96px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}
	h1 {
		margin: 0 0 12px;
		font-family: var(--serif);
		font-size: 38px;
		font-weight: 500;
		letter-spacing: -0.015em;
	}
	.lede,
	.prompt p {
		margin: 0;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.6;
	}
	.prompt {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.pending {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		white-space: nowrap;
	}
	.grow {
		flex-grow: 1;
		min-width: 0;
	}
	.stale {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 16px;
		border-radius: 12px;
		background: var(--popover);
		box-shadow: 0 0 0 1px var(--popover-line);
		color: var(--muted);
		font-size: 14.5px;
		line-height: 1.55;
	}
	.stale .btn {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.stale strong {
		color: var(--agent-text);
		font-weight: 500;
	}
	.confirm-text,
	.confirm-stale {
		margin: 0;
		color: var(--muted);
		font-size: 14.5px;
		line-height: 1.6;
	}
	.confirm-stale {
		color: var(--agent-text);
	}
	.posted {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-radius: 12px;
		background: var(--done-bg);
		color: var(--done);
		font-size: 14.5px;
	}
	.posted a {
		color: var(--done);
		font-size: 13.5px;
	}
	.review {
		display: flex;
		flex-direction: column;
	}
	.card {
		border-radius: 12px;
		overflow: hidden;
		background: var(--surface);
		box-shadow: 0 0 0 1px var(--line-2);
		transition: opacity 0.15s;
	}
	.card header,
	.row-head {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		font-size: 13.5px;
	}
	.card header {
		padding: 8px 10px 8px 16px;
		border-bottom: 1px solid var(--line-2);
		background: var(--surface-2);
	}
	.viewer {
		font-weight: 600;
	}
	.card-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 14px 16px 16px;
	}
	.in-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.summary {
		display: flex;
		flex-direction: column;
		transition: opacity 0.15s;
	}
	.out {
		opacity: 0.4;
	}
	.where {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.thread {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-left: 22px;
		padding: 18px 0 0 22px;
		border-left: 2px solid var(--line-2);
	}
	.lines :global(.lines) {
		border-radius: 0;
	}
	.lines :global(.path) {
		display: none;
	}
	.link {
		flex-shrink: 0;
		border: 0;
		background: none;
		padding: 0;
		color: var(--faint);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	section {
		display: flex;
		flex-direction: column;
	}
	.fold-head {
		display: flex;
		align-items: center;
		align-self: flex-start;
		gap: 10px;
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font-family: var(--serif);
		font-size: 19px;
		cursor: pointer;
	}
	.fold-head:hover {
		color: var(--text);
	}
	.count {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--faint);
	}
	.dropped {
		list-style: none;
		margin: 12px 0 0;
		padding: 0 0 0 24px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		font-size: 13.5px;
	}
	.dropped li {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.said {
		color: var(--muted);
	}
	.send {
		gap: 14px;
		padding: 18px 20px;
		border-radius: 14px;
		background: var(--surface);
		box-shadow: 0 0 0 1px var(--line-2);
	}
	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.send p {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.6;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		font-size: 13.5px;
	}
	.events {
		display: flex;
		align-self: flex-start;
		padding: 2px;
		border-radius: 10px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.events button {
		height: 30px;
		padding: 0 14px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.events button.on {
		background: #ece8df;
		color: #141413;
	}
	.events button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.big {
		height: 42px;
		padding: 0 18px;
		border-radius: 12px;
		font-size: 14.5px;
	}
	.bad {
		margin: 0;
		color: var(--danger);
		font-size: 14px;
	}
</style>
