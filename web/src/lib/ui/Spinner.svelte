<script lang="ts">
	// In the agent's amber, or in blue where it stands for a round under way.
	let { size = 16, label = 'Working', tone = 'agent' }: { size?: number; label?: string; tone?: 'agent' | 'you' } = $props();
</script>

<svg class="spin" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label}>
	<circle cx="8" cy="8" r="6.5" stroke="var(--{tone}-chip)" stroke-width="2.5" fill="none" />
	<path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="var(--{tone})" stroke-width="2.5" fill="none" stroke-linecap="round" />
</svg>

<style>
	.spin {
		animation: spin 0.9s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
</style>
