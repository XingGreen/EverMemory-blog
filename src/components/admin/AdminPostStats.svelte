<script lang="ts">
/**
 * 字数与阅读时长（后台版）。
 *
 * 移植自前台文章页 `src/pages/posts/[...slug].astro` 的
 * 「word count and reading time」一行：图标方块 + 数字，浅灰、低对比，
 * 放在标题上方。后台没有构建期 frontmatter，数字由 reading-stats 现算，
 * 口径与前台 remark 插件一致。
 */
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let {
	words = 0,
	minutes = 0,
	password = false,
}: {
	words?: number;
	minutes?: number;
	password?: boolean;
} = $props();
</script>

<div class="post-stats">
	<div class="stat">
		<span class="stat-icon"><Icon icon="material-symbols:notes-rounded" /></span>
		<span class="stat-text">{words} {i18n(I18nKey.wordsCount)}</span>
	</div>
	<div class="stat">
		<span class="stat-icon"
			><Icon icon="material-symbols:schedule-outline-rounded" /></span
		>
		<span class="stat-text">
			{minutes}
			{i18n(minutes === 1 ? I18nKey.minuteCount : I18nKey.minutesCount)}
		</span>
	</div>
	{#if password}
		<div class="stat">
			<span class="stat-icon"><Icon icon="material-symbols:lock-outline" /></span>
			<span class="stat-text">{i18n(I18nKey.postEncrypted)}</span>
		</div>
	{/if}
</div>

<style>
	/* 数值对齐前台：gap-5(1.25rem)、图标 1.5rem 方块、文字 0.875rem，
	   颜色用内容页的弱化文字色，比正文标题低一档 */
	.post-stats {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1.25rem;
		margin-bottom: 0.75rem;
		color: color-mix(in oklab, var(--deep-text) 45%, transparent);
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.stat-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-md, 0.375rem);
		background: color-mix(in oklab, var(--deep-text) 6%, transparent);
		font-size: 1rem;
	}

	.stat-text {
		font-size: 0.875rem;
		line-height: 1.4;
	}
</style>
