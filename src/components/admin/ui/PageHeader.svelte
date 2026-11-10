<script lang="ts">
import type { Snippet } from "svelte";

/**
 * 页头（docs/ADMIN_UI.md §5）。
 *
 * 一行：标题（+ 可选一行说明）、轨道槽、右侧操作槽。
 * 两档字号：默认 28，列表页用 dense 的 21——那里列表才是内容，标题只是家具。
 *
 * 页头独占页脚那条通栏细线；页面里不许再画第二条，也不许自己覆盖内距。
 */
let {
	title,
	meta = "",
	dense = false,
	rail,
	actions,
}: {
	title: string;
	/** 标题下的一行说明，可省略；不要用它复述计数 */
	meta?: string;
	/** 列表页专用：标题降到 21，把高度让给内容 */
	dense?: boolean;
	/** 紧挨标题的筛选轨（状态、分面），可横滑 */
	rail?: Snippet;
	/** 右侧操作组：搜索、主次按钮 */
	actions?: Snippet;
} = $props();
</script>

<header class="page-header" class:dense>
	<div class="page-header-title">
		<h1>{title}</h1>
		{#if meta}
			<p>{meta}</p>
		{/if}
	</div>

	{#if rail}
		<div class="page-header-rail">
			{@render rail()}
		</div>
	{/if}

	<div class="page-header-spacer"></div>

	{#if actions}
		<div class="page-header-actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-shrink: 0;
		padding: 1.25rem var(--admin-gutter, 1.5rem);
		border-bottom: 1px solid var(--line-divider);
	}

	.page-header-title {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		flex-shrink: 0;
	}

	.page-header h1 {
		margin: 0;
		font-size: var(--admin-fs-page, 1.75rem);
		font-weight: 650;
		line-height: 1.35;
		color: var(--deep-text);
	}

	/* dense：列表页的标题不该和内容抢注意力 */
	.page-header.dense h1 {
		font-size: var(--admin-fs-page-dense, 1.3125rem);
		line-height: 1.3;
		letter-spacing: 0.01em;
	}

	.page-header p {
		margin: 0;
		font-size: var(--admin-fs-meta, 0.75rem);
		line-height: 1.6;
		color: var(--content-meta);
	}

	.page-header-rail {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.page-header-rail::-webkit-scrollbar {
		display: none;
	}

	.page-header-spacer {
		flex: 1 1 auto;
		min-width: 0;
	}

	.page-header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	/* 窄屏：顶栏已经在显示页面名，页头只留轨道与操作 */
	@media (max-width: 1023px) {
		.page-header {
			flex-wrap: wrap;
			gap: 0.75rem 1rem;
			padding: 0.75rem 1.125rem;
		}

		.page-header-title {
			display: none;
		}

		.page-header-spacer {
			display: none;
		}

		.page-header-rail {
			order: 1;
		}

		.page-header-actions {
			order: 2;
			flex: 1 1 100%;
		}
	}
</style>
