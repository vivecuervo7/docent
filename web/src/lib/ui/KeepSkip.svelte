<script lang="ts">
	// Keep or skip, one switch wherever it's decided: your choice fills its
	// half; the panel's, standing until you make one, is only outlined.
	// `agent` sits in a finding's brown bubble.
	let {
		kept,
		suggested = false,
		tone = 'plain',
		onkeep,
		onskip
	}: { kept: boolean | null; suggested?: boolean; tone?: 'plain' | 'agent'; onkeep: () => void; onskip: () => void } = $props();
</script>

<div class="decide {tone}" role="group" aria-label="Keep or skip{suggested ? ', as the panel suggests' : ''}">
	<button class="keep" class:on={kept === true} class:suggested aria-pressed={kept === true} onclick={onkeep}>Keep</button>
	<button class="skip" class:on={kept === false} class:suggested aria-pressed={kept === false} onclick={onskip}>Skip</button>
</div>

<style>
	.decide {
		flex-shrink: 0;
		display: flex;
		padding: 2px;
		border-radius: 9px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	button {
		height: 28px;
		padding: 0 12px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	button.on {
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
	}
	button.keep.on {
		background: var(--done-bg);
		box-shadow: none;
		color: #fff;
	}
	button.on.suggested {
		background: none;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
	}
	/* In the brown: the well of the box you ask in, and the choice made in a
	   light tan of the same brown. */
	.agent {
		background: color-mix(in srgb, var(--popover) 50%, var(--bg));
		box-shadow: inset 0 0 0 1px var(--popover-line);
	}
	.agent button.on,
	.agent button.keep.on {
		background: var(--agent-text);
		box-shadow: none;
		color: #1f1c17;
	}
	/* Skip a shade darker than Keep. */
	.agent button.skip.on {
		background: #b8a78f;
	}
	.agent button.on.suggested {
		background: none;
		box-shadow: inset 0 0 0 1px var(--popover-line);
		color: var(--text);
	}
</style>
