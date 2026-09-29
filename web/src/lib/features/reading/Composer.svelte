<script lang="ts">
	import { MOD } from '$lib/ui/keys';

	// Where the reviewer writes on a thread: Ask sends it to Docent for a
	// reply, Comment keeps it as a comment to post as written. Enter asks and
	// Mod+Enter comments. The draft is bound, so it outlives the box closing.
	let {
		value = $bindable(''),
		placeholder,
		rows = 1,
		autofocus = false,
		actionsAlways = false,
		askDisabled = false,
		onsend,
		onescape
	}: {
		value?: string;
		placeholder: string;
		rows?: number;
		autofocus?: boolean;
		// Shows the buttons before anything is written, not only once it is.
		actionsAlways?: boolean;
		askDisabled?: boolean;
		onsend: (text: string, options: { comment: boolean }) => void;
		onescape?: () => void;
	} = $props();

	function send(comment: boolean) {
		const text = value.trim();
		if (!text || (askDisabled && !comment)) return;
		onsend(text, { comment });
		value = '';
	}

	// Taking focus as it opens, so typing goes here and never to the page's
	// shortcuts. Autofocus alone loses to whatever held focus.
	function focusNow(node: HTMLElement) {
		if (autofocus) requestAnimationFrame(() => node.focus());
	}
</script>

<div class="composer">
	<!-- Growing with its text ignores rows, so rows sets its least height. -->
	<textarea
		bind:value
		{rows}
		style:min-height={rows > 1 ? `calc(${rows} * 1.5em + 18px)` : undefined}
		use:focusNow
		{placeholder}
		aria-label="Ask or comment"
		onkeydown={(e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				send(e.metaKey || e.ctrlKey);
			} else if (e.key === 'Escape' && onescape) onescape();
		}}
	></textarea>
	{#if actionsAlways || value.trim()}
		<div class="foot">
			<span class="faint">Enter to ask · {MOD}Enter to comment</span>
			<button class="btn" disabled={!value.trim()} onclick={() => send(true)}>Comment</button>
			<button class="btn primary" disabled={!value.trim() || askDisabled} onclick={() => send(false)}>Ask</button>
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
