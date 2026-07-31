<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";

	let {
		posts,
		isLoading,
		error,
		onEdit,
		onDelete,
		onRefresh,
	}: {
		posts: any[];
		isLoading: boolean;
		error: string;
		onEdit: (post: any) => void;
		onDelete: (post: any) => void;
		onRefresh: () => void;
	} = $props();

	let searchTerm = $state("");
	let statusFilter = $state<"all" | "published" | "draft">("all");

	const filteredPosts = $derived.by(() => {
		let result = [...posts];

		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			result = result.filter(
				(post) =>
					post.title.toLowerCase().includes(term) ||
					post.author.toLowerCase().includes(term) ||
					post.category.toLowerCase().includes(term) ||
					post.tags.some((tag: string) => tag.toLowerCase().includes(term)),
			);
		}

		if (statusFilter === "published") {
			result = result.filter((post) => !post.draft);
		} else if (statusFilter === "draft") {
			result = result.filter((post) => post.draft);
		}

		return result;
	});

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}
</script>

<div class="card-base post-list-container">
	<div class="toolbar">
		<div class="search-box">
			<Icon icon="material-symbols:search" class="search-icon" />
			<input
				type="text"
				bind:value={searchTerm}
				placeholder="搜索文章标题、作者、分类或标签..."
				class="search-input"
			/>
			{#if searchTerm}
				<button
					class="clear-search"
					onclick={() => {
						searchTerm = "";
					}}
					aria-label="清除搜索"
				>
					<Icon icon="material-symbols:close" class="text-sm" />
				</button>
			{/if}
		</div>

		<div class="filter-tabs">
			<button
				class="tab"
				class:active={statusFilter === "all"}
				onclick={() => {
					statusFilter = "all";
				}}
			>
				全部 ({posts.length})
			</button>
			<button
				class="tab"
				class:active={statusFilter === "published"}
				onclick={() => {
					statusFilter = "published";
				}}
			>
				已发布 ({posts.filter((p) => !p.draft).length})
			</button>
			<button
				class="tab"
				class:active={statusFilter === "draft"}
				onclick={() => {
					statusFilter = "draft";
				}}
			>
				草稿 ({posts.filter((p) => p.draft).length})
			</button>
		</div>

		<button class="refresh-btn" onclick={onRefresh} disabled={isLoading}>
			{#if isLoading}
				<span class="spinner"></span>
			{:else}
				<Icon icon="material-symbols:update-rounded" class="text-sm" />
			{/if}
			刷新
		</button>
	</div>

	{#if isLoading}
		<div class="loading-state">
			<div class="loader"></div>
			<p>加载文章列表...</p>
		</div>
	{:else if error}
		<div class="error-state">
			<Icon icon="material-symbols:error-outline" class="error-icon" />
			<p>{error}</p>
			<button class="retry-btn" onclick={onRefresh}>重试</button>
		</div>
	{:else if filteredPosts.length === 0}
		<div class="empty-state">
			<Icon icon="material-symbols:folder-open" class="empty-icon" />
			<p>暂无文章</p>
			{#if searchTerm || statusFilter !== "all"}
				<button
					class="clear-filter-btn"
					onclick={() => {
						searchTerm = "";
						statusFilter = "all";
					}}
				>
					清除筛选
				</button>
			{/if}
		</div>
	{:else}
		<div class="table-wrapper">
			<table class="posts-table">
				<thead>
					<tr>
						<th class="col-title">标题</th>
						<th class="col-author">作者</th>
						<th class="col-category">分类</th>
						<th class="col-date">发布日期</th>
						<th class="col-status">状态</th>
						<th class="col-actions">操作</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredPosts as post (post.id)}
						<tr>
							<td class="col-title">
								<div class="title-cell">
									<div class="title-row">
										{#if post.pinned}
											<Icon icon="material-symbols:pinboard" class="pinned-badge" title="置顶" />
										{/if}
										<span class="title-text">{post.title}</span>
									</div>
									{#if post.tags && post.tags.length > 0}
										<div class="tags">
											{#each post.tags.slice(0, 3) as tag}
												<span class="tag">{tag}</span>
											{/each}
											{#if post.tags.length > 3}
												<span class="tag more">+{post.tags.length - 3}</span>
											{/if}
										</div>
									{/if}
								</div>
							</td>
							<td class="col-author">
								{post.author || ""}
							</td>
							<td class="col-category">
								{post.category || ""}
							</td>
							<td class="col-date">
								<span class="date-text">{formatDate(post.published)}</span>
							</td>
							<td class="col-status">
								{#if post.draft}
									<span class="status-badge draft">草稿</span>
								{:else}
									<span class="status-badge published">已发布</span>
								{/if}
							</td>
							<td class="col-actions">
								<div class="action-buttons">
									<a
										class="action-btn view"
										href={`/posts/${post.slug}`}
										target="_blank"
										title="查看"
									>
										<Icon icon="material-symbols:visibility-outline-rounded" class="text-sm" />
									</a>
									<button
										class="action-btn edit"
										onclick={() => {
											onEdit(post);
										}}
										title="编辑"
									>
										<Icon icon="material-symbols:ink-pen-outline-rounded" class="text-sm" />
									</button>
									<button
										class="action-btn delete"
										onclick={() => {
											onDelete(post);
										}}
										title="删除"
									>
										<Icon icon="material-symbols:close" class="text-sm" />
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="table-footer">
			<p>共 {filteredPosts.length} 篇文章</p>
		</div>
	{/if}
</div>

<style>
	.post-list-container {
		padding: 1.5rem;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.search-box {
		flex: 1;
		min-width: 200px;
		position: relative;
		display: flex;
		align-items: center;
	}

	:global(.search-icon) {
		position: absolute;
		left: 0.75rem;
		font-size: 1rem;
		color: var(--content-meta);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.5rem 2.25rem 0.5rem 2.25rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		transition: border-color 0.2s;
		background: var(--card-bg);
		color: var(--deep-text);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.clear-search {
		position: absolute;
		right: 0.375rem;
		width: 20px;
		height: 20px;
		border: none;
		border-radius: var(--radius-sm);
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}

	.clear-search:hover {
		background: var(--btn-regular-bg-hover);
		color: var(--deep-text);
	}

	.filter-tabs {
		display: flex;
		gap: 0.25rem;
	}

	.tab {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		background: var(--card-bg);
		color: var(--content-meta);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
		font-weight: 500;
	}

	.tab:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.tab.active {
		background: var(--primary);
		color: white;
		border-color: var(--primary);
	}

	.refresh-btn {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		background: var(--card-bg);
		color: var(--content-meta);
		font-size: 0.8rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		transition: all 0.15s;
		font-weight: 500;
	}

	.refresh-btn:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--line-divider);
		border-top-color: var(--primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-state,
	.error-state,
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}

	.loader {
		width: 36px;
		height: 36px;
		border: 3px solid var(--line-divider);
		border-top-color: var(--primary);
		border-radius: 50%;
		margin: 0 auto 0.75rem;
		animation: spin 0.8s linear infinite;
	}

	.loading-state p,
	.error-state p,
	.empty-state p {
		color: var(--content-meta);
		font-size: 0.875rem;
	}

	:global(.error-icon),
	:global(.empty-icon) {
		font-size: 2.5rem;
		display: block;
		margin: 0 auto 0.75rem;
		color: var(--content-meta);
	}

	:global(.error-icon) {
		color: #ef4444;
	}

	.retry-btn,
	.clear-filter-btn {
		margin-top: 0.75rem;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		background: var(--primary);
		color: white;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.retry-btn:hover,
	.clear-filter-btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.table-wrapper {
		overflow-x: auto;
	}

	.posts-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.posts-table thead {
		background: var(--btn-regular-bg);
	}

	.posts-table th {
		padding: 0.625rem 0.875rem;
		text-align: left;
		font-weight: 600;
		color: var(--deep-text);
		font-size: 0.8rem;
	}

	.posts-table td {
		padding: 0.75rem 0.875rem;
		border-bottom: 1px solid var(--line-divider);
		color: var(--deep-text);
	}

	.posts-table tbody tr:hover {
		background: var(--btn-plain-bg-hover);
	}

	.col-title {
		min-width: 180px;
		max-width: 300px;
	}

	.title-cell {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.title-text {
		font-weight: 500;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.pinned-badge) {
		color: var(--primary);
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.tags {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.tag {
		padding: 0.125rem 0.5rem;
		background: var(--btn-regular-bg);
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		color: var(--content-meta);
	}

	.tag.more {
		background: transparent;
		color: var(--content-meta);
	}

	.date-text {
		color: var(--content-meta);
		font-size: 0.8rem;
	}

	.status-badge {
		display: inline-block;
		padding: 0.125rem 0.625rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.status-badge.published {
		background: color-mix(in srgb, #22c55e 15%, transparent);
		color: #22c55e;
	}

	.status-badge.draft {
		background: color-mix(in srgb, #f59e0b 15%, transparent);
		color: #f59e0b;
	}

	.action-buttons {
		display: flex;
		gap: 0.25rem;
	}

	.action-btn {
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		transition: all 0.15s;
	}

	.action-btn.view {
		background: color-mix(in srgb, #3b82f6 15%, transparent);
		color: #3b82f6;
	}

	.action-btn.view:hover {
		background: #3b82f6;
		color: white;
	}

	.action-btn.edit {
		background: color-mix(in srgb, var(--primary) 15%, transparent);
		color: var(--primary);
	}

	.action-btn.edit:hover {
		background: var(--primary);
		color: white;
	}

	.action-btn.delete {
		background: color-mix(in srgb, #ef4444 15%, transparent);
		color: #ef4444;
	}

	.action-btn.delete:hover {
		background: #ef4444;
		color: white;
	}

	.table-footer {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line-divider);
		text-align: right;
		color: var(--content-meta);
		font-size: 0.8rem;
	}

	@media (max-width: 768px) {
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.filter-tabs {
			overflow-x: auto;
		}

		.posts-table {
			font-size: 0.8rem;
		}

		.posts-table th,
		.posts-table td {
			padding: 0.5rem;
		}

		.col-author,
		.col-date {
			display: none;
		}
	}
</style>
