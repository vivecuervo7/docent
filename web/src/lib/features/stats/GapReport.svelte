<script lang="ts">
	import { THEMES, THEME_LABELS, type Analysis, type Theme } from './stats';

	// Theme by theme, what the panel raised and kept beside what others
	// raised after it that it didn't: set aside itself, or missed. What
	// others raised that the panel had caught is already in its share.
	let { gaps, kept }: { gaps: Analysis['gaps']; kept: Partial<Record<Theme, number>> } = $props();

	const themes = $derived(
		THEMES.filter((t) => kept[t] || gaps.byTheme[t]).map((t) => {
			const panel = kept[t] ?? 0;
			const { setAside = 0, missed = 0 } = gaps.byTheme[t] ?? {};
			return { theme: t, panel, setAside, missed, total: panel + setAside + missed };
		})
	);
	const most = $derived(Math.max(1, ...themes.map((t) => t.total)));
</script>

<ul class="themes">
	{#each themes as t (t.theme)}
		<li>
			<span>{THEME_LABELS[t.theme]}</span>
			<span class="bar" title="{t.panel} raised by the panel · {t.setAside} set aside · {t.missed} missed" style:width="{(t.total / most) * 100}%">
				<span class="panel" style:flex={t.panel}></span>
				<span class="aside" style:flex={t.setAside}></span>
				<span class="missed" style:flex={t.missed}></span>
			</span>
			<span class="faint count">{Math.round((t.panel / t.total) * 100)}%</span>
		</li>
	{/each}
</ul>
<div class="key faint">
	<span class="swatch panel"></span>Raised by the panel <span class="swatch aside"></span>Raised by others, set aside by the panel
	<span class="swatch missed"></span>Raised only by others
</div>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	li {
		padding: 11px 16px;
		border-top: 1px solid var(--line);
		font-size: 14px;
	}
	li:first-child {
		border-top: 0;
	}
	.themes li {
		display: grid;
		grid-template-columns: 160px minmax(0, 1fr) 40px;
		align-items: center;
		gap: 14px;
	}
	.bar {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
	}
	.count {
		text-align: right;
		font-size: 13px;
	}
	.panel {
		background: var(--state-done);
	}
	.aside {
		background: #627566;
	}
	.missed {
		background: var(--minus-dull);
	}
	.key {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12.5px;
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-left: 8px;
		border-radius: 2px;
	}
	.swatch:first-child {
		margin-left: 0;
	}
</style>
