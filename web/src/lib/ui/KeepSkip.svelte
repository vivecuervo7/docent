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
	/* The choice made in the app's off-white: Keep solid, Skip faint, so the
	   box behind tints it. */
	button.on {
		box-shadow: none;
	}
	button.keep.on {
		background: var(--chosen);
		color: var(--popover);
	}
	button.skip.on {
		background: rgb(236 232 223 / 0.24);
		color: var(--text);
	}
	button.on.suggested {
		background: none;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text);
	}
	/* In the brown, the well of the box you ask in. */
	.agent {
		background: color-mix(in srgb, var(--popover) 50%, var(--bg));
		box-shadow: inset 0 0 0 1px var(--popover-line);
	}
	.agent button.on.suggested {
		box-shadow: inset 0 0 0 1px var(--popover-line);
	}
</style>
