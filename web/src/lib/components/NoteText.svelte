<script lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';

	// Markdown written by the model or the reviewer, rendered the way GitHub
	// would. It's sanitised, since the model's text can carry anything.
	let { text }: { text: string } = $props();

	// A rule written straight under a line would read as underlining it into a
	// heading; models mean a rule, so it gets the blank lines it needs.
	const html = $derived(
		DOMPurify.sanitize(marked.parse(text.replace(/\n *(-{3,}|\*{3,}|_{3,}) *\n/g, '\n\n$1\n\n'), { gfm: true, breaks: true, async: false }))
	);
</script>

<!-- Its blocks sit directly in the caller's layout, which spaces them. -->
<div class="md">{@html html}</div>

<style>
	.md {
		display: contents;
	}
	.md :global(:is(p, ul, ol, pre, blockquote, h1, h2, h3, h4)) {
		margin: 0;
	}
	.md :global(:is(ul, ol)) {
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.md :global(:is(h1, h2, h3, h4)) {
		font-size: 1em;
		font-weight: 600;
	}
	.md :global(pre) {
		padding: 10px 12px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.04);
		overflow-x: auto;
		font-size: 12.5px;
		line-height: 1.55;
	}
	.md :global(pre code) {
		padding: 0;
		background: none;
		font-size: inherit;
	}
	.md :global(blockquote) {
		padding-left: 12px;
		border-left: 2px solid var(--line-2);
		color: var(--muted);
	}
	.md :global(hr) {
		width: 100%;
		margin: 2px 0;
		border: 0;
		border-top: 1px solid var(--line-2);
	}
	.md :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
