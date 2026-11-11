<script lang="ts">
import type { Snippet } from "svelte";
import { usePageIntroStore } from "./page-intro.svelte";
import PageHeader from "./ui/PageHeader.svelte";

/**
 * 后台页面外壳（页头 + 内容区 + 可选页脚）
 *
 * 页头由 `ui/PageHeader` 提供（docs/ADMIN_UI.md §5），本组件只负责
 * 卡片、唯一滚动区与页脚槽位。页面不再自己画标题区。
 *
 * actions 槽位（可选）：透传给 PageHeader 的右侧操作按钮组。
 *
 * footer 槽位（可选）：放在内容区**之外**、外壳内部，不参与滚动，始终可见。
 */
let {
	title,
	intro,
	children,
	footer,
	actions: actionsSnippet,
}: {
	title: string;
	intro?: string;
	children: Snippet;
	footer?: Snippet;
	actions?: Snippet;
} = $props();

/**
 * 窄屏下说明文字隐藏，问号入口由顶栏（AdminDashboard）渲染在标题右侧。
 * 这里只负责把当前页的说明交给外壳，按钮与气泡都不在本组件里，
 * 避免入口落在正文内容区中。
 */
const pageIntro = usePageIntroStore();

$effect(() => {
	if (!pageIntro) return;
	pageIntro.value = intro ?? "";
	return () => {
		pageIntro.value = "";
	};
});
</script>

<div class="card-base admin-page">
	<!-- 页头本身由原语提供：外壳只负责卡片、滚动区与页脚。
	     原先这里自己画一遍 28/650 标题区，是后台第 4 种页头实现。 -->
	{#if actionsSnippet}
		<PageHeader {title} meta={intro ?? ""}>
			{#snippet actions()}
				{@render actionsSnippet()}
			{/snippet}
		</PageHeader>
	{:else}
		<PageHeader {title} meta={intro ?? ""} />
	{/if}
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
		gap: var(--admin-block-gap, 1.25rem);
		padding: var(--admin-block-gap, 1.25rem) var(--admin-gutter, 1.5rem)
			var(--admin-gutter, 1.5rem);
	}

	.admin-page-body > :global(*) {
		flex-shrink: 0;
	}

	/* 内容留白对齐参考项目 post-manager：窄屏收到 18px，把省下的宽度让给内容。
	   必须写在基础规则之后——同权重下后出现的声明才生效。 */
	@media (max-width: 1023px) {
		.admin-page-body {
			gap: 1rem;
			padding: 0 1.125rem 1.125rem;
		}
	}

	/* 页脚槽位：内容区之外的独立区块，不参与滚动。
	   flex-shrink:0 保证它不会被内容挤压缩小，
	   内容再长也只在 .admin-page-body 内滚。 */
	.admin-page-footer {
		flex-shrink: 0;
	}
</style>
