<script lang="ts">
import type { Snippet } from "svelte";

/**
 * 后台页面外壳（标题区 + 内容区 + 可选页脚）
 *
 * 统一「卡片外壳 + 标题区 + 内容区」的结构，对应参考项目
 * settings-shell 的 settings-workspace + settings-heading 组合。
 *
 * 标题区规格与设置页 settings-heading 一致：
 * 28px/650 标题 + 13px 灰字简介、padding 28px 24px 20px。
 * 内容区自带 24px 左右留白，页面只负责内容本身。
 *
 * actions 槽位（可选）：标题区右侧的操作按钮组，
 * 用于文章列表这类「标题 + 计数 + 主操作」的页头。
 *
 * footer 槽位（可选）：放在内容区**之外**、外壳内部，
 * 不参与滚动，始终可见——对应参考项目 settings-shell 里
 * <footer class="settings-savebar"> 位于 settings-body 之外的结构。
 * 暂不含 tabs 槽位：设置页 settings-workspace 是四段结构且自带内部滚动，
 * 仍保持独立；等第二个页面需要 tabs 时再升级。
 */
let {
	title,
	intro,
	children,
	footer,
	actions,
}: {
	title: string;
	intro?: string;
	children: Snippet;
	footer?: Snippet;
	actions?: Snippet;
} = $props();
</script>

<div class="card-base admin-page">
	<header class="admin-page-heading">
		<div class="heading-text">
			<h1>{title}</h1>
			{#if intro}
				<p>{intro}</p>
			{/if}
		</div>
		{#if actions}
			<div class="heading-actions">
				{@render actions()}
			</div>
		{/if}
	</header>
	<div class="admin-page-body">
		{@render children()}
	</div>
	{#if footer}
		<div class="admin-page-footer">
			{@render footer()}
		</div>
	{/if}
</div>

<style>
	/* 外壳撑满限高的 .admin-content：标题固定、内容区自己滚动。
	   高度用 var(--admin-viewport-h)（由 AdminDashboard 定义并已按
	   zoom 反算），保证与左侧边栏等高。 */
	.admin-page {
		display: flex;
		flex-direction: column;
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		min-height: 0;
		overflow: hidden;
	}

	/* 与 AdminDashboard 的 .settings-heading 取同一组数值，
	     两处改动需同步。
	     横向布局：左侧标题/简介，右侧操作按钮组（有 actions 时）。 */
	.admin-page-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.75rem 1.5rem 1.25rem;
		flex-shrink: 0;
	}

	.heading-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.heading-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.admin-page-heading h1 {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 650;
		line-height: 1.4;
		color: var(--deep-text);
	}

	.admin-page-heading p {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--content-meta);
	}

	/* 内容区是本页唯一的滚动容器；子项 flex-shrink:0 防被压缩后
	   看起来「滚不动」。 */
	.admin-page-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0 1.5rem 1.5rem;
	}

	.admin-page-body > :global(*) {
		flex-shrink: 0;
	}

	/* 页脚槽位：内容区之外的独立区块，不参与滚动。
	   flex-shrink:0 保证它不会被内容挤压缩小，
	   内容再长也只在 .admin-page-body 内滚。 */
	.admin-page-footer {
		flex-shrink: 0;
	}
</style>
