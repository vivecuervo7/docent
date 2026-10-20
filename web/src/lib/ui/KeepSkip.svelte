<script lang="ts">
	// Keep or skip, one switch wherever it's decided: your choice fills its
	// half; the panel's, standing until you make one, is only outlined.
	let {
		kept,
		suggested = false,
		onkeep,
		onskip
	}: { kept: boolean | null; suggested?: boolean; onkeep: () => void; onskip: () => void } = $props();
</script>

<div class="decide" role="group" aria-label="Keep or skip{suggested ? ', as the panel suggests' : ''}">
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
</style>
