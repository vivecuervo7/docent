<script lang="ts">
	import Field from '../../ui/Field.svelte';
	import { appearance, chooseContrast } from '../../ui/appearance.svelte';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection title="Appearance" intro="How Docent looks in this browser.">
	<Field
		label="Contrast"
		element="div"
		for="contrast"
		hint="Toward high contrast, the page darkens and its text brightens, so what sits on it stands out more."
	>
		<div class="contrast">
			<span>As designed</span>
			<input
				id="contrast"
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={appearance.contrast}
				oninput={(e) => chooseContrast(Number(e.currentTarget.value))}
			/>
			<span>High contrast</span>
		</div>
	</Field>
</SettingsSection>

<style>
	.contrast {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--faint);
		font-size: var(--text-sm);
	}
	input {
		width: 240px;
		accent-color: var(--chosen);
	}
</style>
