<script lang="ts">
import { i18n } from "@/i18n/translation";
import I18nKey from "@/i18n/i18nKey";
import Icon from "@/components/common/Icon.svelte";
	import {
		ANIM_SPEED_PRESETS,
		applyAnimSpeed,
		readAnimSpeed,
		writeAnimSpeed,
	} from "@/utils/anim-speed";

	let speed = $state(readAnimSpeed());

	const presetLabels: Record<number, string> = {
		0: i18n(I18nKey.consoleAnimSpeedOff),
		0.5: i18n(I18nKey.consoleAnimSpeedSlow),
		1: i18n(I18nKey.consoleAnimSpeedNormal),
		1.5: i18n(I18nKey.consoleAnimSpeedFast),
		2: i18n(I18nKey.consoleAnimSpeedDouble),
	};

	/**
	 * 立即写入 localStorage 并作用于当前文档，
	 * 用户无需刷新即可看到全站动效快慢的变化。
	 */
	function selectSpeed(value: number) {
		speed = writeAnimSpeed(value);
		applyAnimSpeed(speed);
	}
</script>

<div class="card-base dashboard-section">
	<div class="section-header">
		<h2>{i18n(I18nKey.consoleSettings)}</h2>
	</div>

	<div class="console-group">
		<div class="console-item">
			<div class="console-info">
				<span class="console-label">
					<Icon icon="material-symbols:speed-outline" />
					{i18n(I18nKey.consoleAnimSpeed)}
				</span>
				<span class="console-desc">{i18n(I18nKey.consoleAnimSpeedDesc)}</span>
			</div>
			<div
				class="speed-options"
				role="radiogroup"
				aria-label={i18n(I18nKey.consoleAnimSpeed)}
			>
				{#each ANIM_SPEED_PRESETS as preset (preset)}
					<button
						type="button"
						class="speed-option"
						class:selected={speed === preset}
						role="radio"
						aria-checked={speed === preset}
						onclick={() => selectSpeed(preset)}
					>
						{presetLabels[preset]}
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.console-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.console-item {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem 0.75rem;
		border-radius: var(--radius-lg);
		background: var(--btn-regular-bg);
	}

	.console-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.console-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.console-desc {
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	/* 档位选择：分段控件形态，选中项填主题色 */
	.speed-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.speed-option {
		padding: 0.5rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: 9999px;
		transition:
			color 0.15s,
			background-color 0.15s,
			border-color 0.15s;
	}

	.speed-option:hover {
		color: var(--title-active);
		border-color: var(--line-color);
	}

	.speed-option.selected {
		color: var(--title-active);
		background: color-mix(in oklab, var(--primary) 16%, transparent);
		border-color: color-mix(in oklab, var(--primary) 45%, transparent);
		font-weight: 600;
	}
</style>