<script lang="ts">
import type { Snippet } from "svelte";

/**
 * 后台页面外壳（两段式）
 *
 * 统一「卡片外壳 + 标题区 + 内容区」的结构，对应参考项目
 * settings-shell 的 settings-workspace + settings-heading 组合。
 *
 * 标题区规格与设置页 settings-heading 一致：
 * 28px/650 标题 + 13px 灰字简介、padding 28px 24px 20px。
 * 内容区自带 24px 左右留白，页面只负责内容本身。
 *
 * 暂不含 tabs 与 footer 槽位：设置页的 settings-workspace 是四段结构
 * 且自带内部滚动，仍保持独立；等第二个页面需要 tabs 时再升级。
 */
let {
	title,
	intro,
	children,
}: {
	title: string;
	intro?: string;
	children: Snippet;
} = $props();
</script>

<div class="card-base admin-page">
	<header class="admin-page-heading">
		<h1>{title}</h1>
		{#if intro}
			<p>{intro}</p>
		{/if}
	</header>
	<div class="admin-page-body">
		{@render children()}
	</div>
</div>

<style>
	.admin-page {
		display: flex;
		flex-direction: column;
	}

	/* 与 AdminDashboard 的 .settings-heading 取同一组数值，
	     两处改动需同步 */
	.admin-page-heading {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.75rem 1.5rem 1.25rem;
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

	.admin-page-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0 1.5rem 1.5rem;
	}
</style>
