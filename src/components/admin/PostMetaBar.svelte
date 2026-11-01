<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 文章元数据栏（日期 / 分类 / 标签）。
 * 结构与样式对应前台 src/components/layout/PostMeta.astro + main.css 的 .meta-icon，
 * 但前台那个是 Astro 组件，Svelte 侧无法直接使用，故在此复刻一份并共用：
 *   · 历史版本页：传快照自身的 savedAt / category / tags
 *   · 编辑器预览区：传 editorState 的 published / category / tags
 */
let {
	published = "",
	category = "",
	tags = [],
}: {
	/** 接受 YYYY-MM-DD 或时间戳字符串 */
	published?: string;
	category?: string;
	tags?: string[];
} = $props();

function fmtDate(value: string): string {
	if (!value) return "";
	const ts = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
	if (!Number.isFinite(ts)) return value;
	const d = new Date(ts);
	return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
		d.getDate(),
	).padStart(2, "0")}`;
}
</script>

<div class="post-meta-root">
	<div class="post-meta-item">
		<div class="meta-icon">
			<Icon icon="material-symbols:calendar-today-outline-rounded" />
		</div>
		<span>{fmtDate(published) || "—"}</span>
	</div>
	<div class="post-meta-item">
		<div class="meta-icon">
			<Icon icon="material-symbols:book-2-outline-rounded" />
		</div>
		<span>{category || i18n(I18nKey.postCategoryPlaceholder)}</span>
	</div>
	<div class="post-meta-item">
		<div class="meta-icon">
			<Icon icon="material-symbols:tag-rounded" />
		</div>
		{#if tags.length > 0}
			{#each tags as tag, i (tag)}
				{#if i > 0}
					<span class="post-meta-divider">/</span>
				{/if}
				<span>{tag.trim()}</span>
			{/each}
		{:else}
			<span>{i18n(I18nKey.postMetaTagsEmpty)}</span>
		{/if}
	</div>
</div>

<style>
	/* 抄前台 PostMeta.astro + main.css 442-449 的 .meta-icon */
	.post-meta-root {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-start;
		gap: 0.75rem 1.25rem;
		margin: 0 0 1.5rem;
		padding: 0 0 1.25rem;
		border-bottom: 1px solid var(--post-editor-rule);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--content-meta);
	}

	.post-meta-item {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		flex-shrink: 0;
		flex-grow: 0;
		max-width: 100%;
	}

	.post-meta-item > span {
		white-space: nowrap;
		flex-shrink: 0;
	}

	.meta-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		margin-right: 0.5rem;
		border-radius: 0.375rem;
		background: var(--btn-regular-bg);
		color: var(--btn-content, var(--deep-text));
		transition: colors 0.15s;
	}

	.post-meta-item :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
		fill: currentcolor;
	}

	.post-meta-divider {
		margin-inline: 0.375rem;
		color: var(--line-divider);
		white-space: nowrap;
		flex-shrink: 0;
	}

	@media (max-width: 900px) {
		.post-meta-root {
			gap: 0.5rem 0.875rem;
		}
	}
</style>
