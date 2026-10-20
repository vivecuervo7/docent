<script lang="ts" module>
	export type SendKind = 'ask' | 'comment' | 'conclude';
</script>

<script lang="ts">
	import { MOD } from '$lib/ui/keys';

	// Where the reviewer writes in a conversation. Ask sends it to Docent
	// for a reply. The second action depends on the conversation: Comment
	// keeps it as a comment to post as written; Conclude closes it with the
	// reviewer's decision, which isn't posted but is what drafting follows.
	// Enter asks and Mod+Enter takes the second action. `both` offers Comment
	// and Conclude, for a conversation that runs on, with Mod+Enter commenting.
	// The draft is bound, so it outlives the box closing.
	let {
		value = $bindable(''),
		placeholder,
		second = 'comment',
		rows = 1,
		autofocus = false,
		actionsAlways = false,
		askDisabled = false,
		tone = 'plain',
		onsend,
		onescape
	}: {
		value?: string;
		placeholder: string;
		second?: 'comment' | 'conclude' | 'both';
		rows?: number;
		autofocus?: boolean;
		// Shows the buttons before anything is written, not only once it is.
		actionsAlways?: boolean;
		askDisabled?: boolean;
		// `agent` sits in a finding's amber bubble.
		tone?: 'plain' | 'agent';
		onsend: (text: string, kind: SendKind) => void;
		onescape?: () => void;
	} = $props();

	const secondLabel = $derived(second === 'conclude' ? 'Conclude' : 'Comment');
	const modKind = $derived<SendKind>(second === 'conclude' ? 'conclude' : 'comment');

	function send(kind: SendKind) {
		const text = value.trim();
		if (!text || (askDisabled && kind === 'ask')) return;
		onsend(text, kind);
		value = '';
	}

	// Taking focus as it opens, so typing goes here and never to the page's
	// shortcuts. Autofocus alone loses to whatever held focus.
	function focusNow(node: HTMLElement) {
		if (autofocus) requestAnimationFrame(() => node.focus());
	}
</script>

<div class="composer {tone}">
	<!-- Growing with its text ignores rows, so rows sets its least height. -->
	<textarea
		bind:value
		{rows}
		style:min-height={rows > 1 ? `calc(${rows} * 1.5em + 18px)` : undefined}
		use:focusNow
		{placeholder}
		aria-label="Ask or {secondLabel.toLowerCase()}"
		onkeydown={(e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				send(e.metaKey || e.ctrlKey ? modKind : 'ask');
			} else if (e.key === 'Escape' && onescape) onescape();
		}}
	></textarea>
	{#if actionsAlways || value.trim()}
		<div class="foot">
			<span class="faint">Enter to ask · {MOD}Enter to {secondLabel.toLowerCase()}</span>
			{#if second === 'both'}
				<button
					class="btn"
					disabled={!value.trim()}
					title="Your decision on where this lands; it’s not posted, but drafting follows it"
					onclick={() => send('conclude')}>Conclude</button
				>
			{/if}
			<button
				class="btn"
				disabled={!value.trim()}
				title={second === 'conclude' ? 'Close this with your decision; it’s not posted, but drafting follows it' : 'Post this to the PR as written'}
				onclick={() => send(modKind)}>{secondLabel}</button
			>
			<button class="btn primary" disabled={!value.trim() || askDisabled} onclick={() => send('ask')}>Ask</button>
		</div>
	{/if}
</div>

<style>
	.composer {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: none;
		field-sizing: content;
		max-height: 160px;
		padding: 9px 12px;
		border: 0;
		border-radius: 10px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		line-height: 1.5;
		outline: none;
	}
	textarea:focus {
		box-shadow: inset 0 0 0 1px var(--you);
	}
	.agent textarea {
		background: color-mix(in srgb, var(--popover) 50%, var(--bg));
		box-shadow: inset 0 0 0 1px var(--popover-line);
	}
	.agent textarea:focus {
		box-shadow: inset 0 0 0 1px var(--agent);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.foot .faint {
		flex-grow: 1;
		font-size: 12px;
	}
	.btn:disabled {
		opacity: 0.5;
	}
</style>
