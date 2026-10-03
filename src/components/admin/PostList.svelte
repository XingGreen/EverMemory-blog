<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let {
	posts,
	isLoading,
	error,
	onEdit,
	onDelete,
	onRefresh,
	onSync,
	isSyncing = false,
}: {
	posts: any[];
	isLoading: boolean;
	error: string;
	onEdit: (post: any) => void;
	onDelete: (post: any) => void;
	onRefresh: () => void;
	onSync?: () => void;
	isSyncing?: boolean;
} = $props();

type SortKey = "newest" | "oldest" | "titleAsc" | "titleDesc";

let searchTerm = $state("");
let statusFilter = $state<"all" | "published" | "draft">("all");
let categoryFilter = $state("");
let tagFilter = $state("");
let sortKey = $state<SortKey>("newest");

const categories = $derived.by(() =>
	[...new Set(posts.map((post) => post.category).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b),
	),
);

const tags = $derived.by(() =>
	[...new Set(posts.flatMap((post) => post.tags ?? []).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b),
	),
);

const hasExtraFilter = $derived(
	searchTerm !== "" ||
		statusFilter !== "all" ||
		categoryFilter !== "" ||
		tagFilter !== "",
);

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

	if (categoryFilter) {
		result = result.filter((post) => post.category === categoryFilter);
	}

	if (tagFilter) {
		result = result.filter((post) => post.tags.includes(tagFilter));
	}

	const byTitle = (a: any, b: any) => a.title.localeCompare(b.title, "zh-CN");
	const byDate = (a: any, b: any) =>
		(a.published ? Date.parse(a.published) : 0) -
		(b.published ? Date.parse(b.published) : 0);

	if (sortKey === "newest") result.sort((a, b) => byDate(b, a));
	else if (sortKey === "oldest") result.sort(byDate);
	else if (sortKey === "titleAsc") result.sort(byTitle);
	else result.sort((a, b) => byTitle(b, a));

	return result;
});

function clearAllFilters() {
	searchTerm = "";
	statusFilter = "all";
	categoryFilter = "";
	tagFilter = "";
}

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/** 当前排序落在哪一列、什么方向，供表头 aria-sort 使用 */
const sortColumn = $derived(
	sortKey === "titleAsc" || sortKey === "titleDesc" ? "title" : "date",
);
const sortAscending = $derived(sortKey === "oldest" || sortKey === "titleAsc");

function ariaSortFor(
	column: "title" | "date",
): "ascending" | "descending" | "none" {
	if (sortColumn !== column) return "none";
	return sortAscending ? "ascending" : "descending";
}

function actionLabel(action: string, title: string): string {
	return i18n(I18nKey.postActionLabel)
		.replace("{action}", action)
		.replace("{title}", title);
}
</script>

<div class="md3-list-container card-base">
	<!-- 工具栏 -->
	<div class="toolbar">
		<div class="search-bar">
			<Icon icon="material-symbols:search" class="leading-icon" />
			<input
				type="search"
				bind:value={searchTerm}
				placeholder={i18n(I18nKey.postSearchPlaceholder)}
				aria-label={i18n(I18nKey.postSearchLabel)}
				class="search-input"
			/>
			{#if searchTerm}
				<button
					class="trailing-icon-btn"
					onclick={() => (searchTerm = "")}
					aria-label={i18n(I18nKey.postSearchClear)}
				>
					<Icon icon="material-symbols:close" />
				</button>
			{/if}
		</div>

		<div class="filter-chips" role="group" aria-label={i18n(I18nKey.postStatusFilterGroup)}>
			<button
				class="chip"
				class:selected={statusFilter === "all"}
				aria-pressed={statusFilter === "all"}
				onclick={() => (statusFilter = "all")}
			>
				{#if statusFilter === "all"}
					<Icon icon="material-symbols:check" class="chip-check" />
				{/if}
				<span class="chip-label">{i18n(I18nKey.postAll)}</span>
				<span class="chip-count">{posts.length}</span>
			</button>
			<button
				class="chip"
				class:selected={statusFilter === "published"}
				aria-pressed={statusFilter === "published"}
				onclick={() => (statusFilter = "published")}
			>
				{#if statusFilter === "published"}
					<Icon icon="material-symbols:check" class="chip-check" />
				{/if}
				<span class="chip-label">{i18n(I18nKey.postPublished)}</span>
				<span class="chip-count">{posts.filter((p) => !p.draft).length}</span>
			</button>
			<button
				class="chip"
				class:selected={statusFilter === "draft"}
				aria-pressed={statusFilter === "draft"}
				onclick={() => (statusFilter = "draft")}
			>
				{#if statusFilter === "draft"}
					<Icon icon="material-symbols:check" class="chip-check" />
				{/if}
				<span class="chip-label">{i18n(I18nKey.postDraft)}</span>
				<span class="chip-count">{posts.filter((p) => p.draft).length}</span>
			</button>
		</div>

		<div class="toolbar-actions">
			<button class="icon-text-btn" onclick={onRefresh} disabled={isLoading || isSyncing}>
				{#if isLoading}
					<span class="spinner" aria-hidden="true"></span>
				{:else}
					<Icon icon="material-symbols:update-rounded" />
				{/if}
				{i18n(I18nKey.postRefresh)}
			</button>

			{#if onSync}
				<button class="icon-text-btn sync-btn" onclick={onSync} disabled={isLoading || isSyncing}>
					{#if isSyncing}
						<span class="spinner" aria-hidden="true"></span>
					{:else}
						<Icon icon="material-symbols:cloud" />
					{/if}
					{i18n(I18nKey.postSync)}
				</button>
			{/if}
		</div>
	</div>

	<!-- 分类、标签筛选与排序 -->
	<div class="filter-row" role="group" aria-label={i18n(I18nKey.postFilterGroup)}>
		<label class="select-field">
			<span class="select-label">{i18n(I18nKey.postFilterCategory)}</span>
			<div class="select-wrap">
				<select bind:value={categoryFilter} disabled={categories.length === 0}>
					<option value="">{i18n(I18nKey.postAll)}</option>
					{#each categories as category (category)}
						<option value={category}>{category}</option>
					{/each}
				</select>
				<Icon icon="material-symbols:expand-more" class="select-caret" />
			</div>
		</label>

		<label class="select-field">
			<span class="select-label">{i18n(I18nKey.postFilterTag)}</span>
			<div class="select-wrap">
				<select bind:value={tagFilter} disabled={tags.length === 0}>
					<option value="">{i18n(I18nKey.postAll)}</option>
					{#each tags as tag (tag)}
						<option value={tag}>{tag}</option>
					{/each}
				</select>
				<Icon icon="material-symbols:expand-more" class="select-caret" />
			</div>
		</label>

		<label class="select-field">
			<span class="select-label">{i18n(I18nKey.postSort)}</span>
			<div class="select-wrap">
				<select bind:value={sortKey}>
					<option value="newest">{i18n(I18nKey.postSortNewest)}</option>
					<option value="oldest">{i18n(I18nKey.postSortOldest)}</option>
					<option value="titleAsc">{i18n(I18nKey.postSortTitleAsc)}</option>
					<option value="titleDesc">{i18n(I18nKey.postSortTitleDesc)}</option>
				</select>
				<Icon icon="material-symbols:expand-more" class="select-caret" />
			</div>
		</label>

		{#if hasExtraFilter}
			<button class="text-btn reset-btn" onclick={clearAllFilters}>{i18n(I18nKey.postClearFilter)}</button>
		{/if}
	</div>

	<!-- 列表内容 -->
	{#if isLoading}
		<div class="state-container" role="status" aria-live="polite">
			<div class="circular-progress" aria-hidden="true"></div>
			<p class="state-text">{i18n(I18nKey.postLoading)}</p>
		</div>
	{:else if error}
		<div class="state-container" role="alert">
			<Icon icon="material-symbols:error-outline" class="state-icon error" />
			<p class="state-text" id="post-list-error">{error}</p>
			<button class="filled-btn" onclick={onRefresh} aria-describedby="post-list-error">
				{i18n(I18nKey.postRetry)}
			</button>
		</div>
	{:else if filteredPosts.length === 0}
		<div class="state-container">
			<Icon icon="material-symbols:folder-open" class="state-icon" />
			<p class="state-text">{hasExtraFilter ? i18n(I18nKey.postNoMatch) : i18n(I18nKey.postNoPosts)}</p>
			{#if hasExtraFilter}
				<button class="text-btn" onclick={clearAllFilters}>
					{i18n(I18nKey.postClearFilter)}
				</button>
			{/if}
		</div>
	{:else}
		<div class="md3-table" role="table" aria-label={i18n(I18nKey.postTableLabel)}>
			<!-- 分类栏（表头） -->
			<div class="header-row" role="rowgroup">
				<div class="col col-title" role="columnheader" aria-sort={ariaSortFor("title")}>
					{i18n(I18nKey.postColTitle)}
				</div>
				<div class="col col-author" role="columnheader">{i18n(I18nKey.postColAuthor)}</div>
				<div class="col col-category" role="columnheader">{i18n(I18nKey.postColCategory)}</div>
				<div class="col col-date" role="columnheader" aria-sort={ariaSortFor("date")}>
					{i18n(I18nKey.postColDate)}
				</div>
				<div class="col col-status" role="columnheader">{i18n(I18nKey.postColStatus)}</div>
				<div class="col col-actions" role="columnheader">{i18n(I18nKey.postColActions)}</div>
			</div>

			<!-- 列表项 -->
			<div class="md3-list" role="rowgroup">
				{#each filteredPosts as post (post.id)}
					<div class="list-item" role="row">
						<!-- 标题 -->
						<div class="col col-title" role="cell" data-label={i18n(I18nKey.postColTitle)}>
							<div class="title-cell">
								<div class="title-row">
									{#if post.pinned}
										<span class="pin-wrap">
											<Icon icon="material-symbols:pinboard" class="pin-icon" />
											<span class="sr-only">{i18n(I18nKey.postPinned)}</span>
										</span>
									{/if}
									<span class="title" title={post.title}>{post.title}</span>
								</div>
								{#if post.tags && post.tags.length > 0}
									<div class="tags">
										{#each post.tags.slice(0, 3) as tag}
											<span class="tag">{tag}</span>
										{/each}
										{#if post.tags.length > 3}
											<span
												class="tag-more"
												aria-label={i18n(I18nKey.postMoreTags).replace("{count}", String(post.tags.length - 3))}
											>
												+{post.tags.length - 3}
											</span>
										{/if}
									</div>
								{/if}
							</div>
						</div>

						<!-- 作者 -->
						<div class="col col-author" role="cell" data-label={i18n(I18nKey.postColAuthor)}>
							<span class="text-meta" title={post.author || ""}>{post.author || "—"}</span>
						</div>

						<!-- 分类 -->
						<div class="col col-category" role="cell" data-label={i18n(I18nKey.postColCategory)}>
							<span class="text-meta">{post.category || "—"}</span>
						</div>

						<!-- 发布日期 -->
						<div class="col col-date" role="cell" data-label={i18n(I18nKey.postColDate)}>
							<span class="text-meta">{post.published ? formatDate(post.published) : "—"}</span>
						</div>

						<!-- 状态 -->
						<div class="col col-status" role="cell" data-label={i18n(I18nKey.postColStatus)}>
							<span class="status-chip" data-draft={post.draft}>
								<Icon
									icon={post.draft ? "material-symbols:edit-note" : "material-symbols:check-circle-outline"}
									class="status-icon"
								/>
								{post.draft ? i18n(I18nKey.postDraft) : i18n(I18nKey.postPublished)}
							</span>
						</div>

						<!-- 操作（文字按钮） -->
						<div class="col col-actions" role="cell" data-label={i18n(I18nKey.postColActions)}>
							<div class="text-actions">
								<a
									class="text-action view"
									href={`/posts/${post.slug}`}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={actionLabel(i18n(I18nKey.postView), post.title)}
								>
									{i18n(I18nKey.postView)}
								</a>
								<button
									class="text-action edit"
									onclick={() => onEdit(post)}
									aria-label={actionLabel(i18n(I18nKey.postEdit), post.title)}
								>
									{i18n(I18nKey.postEdit)}
								</button>
								<button
									class="text-action delete"
									onclick={() => onDelete(post)}
									aria-label={actionLabel(i18n(I18nKey.postDelete), post.title)}
								>
									{i18n(I18nKey.postDelete)}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="list-footer">
			<span>{i18n(I18nKey.postListCount).replace("{count}", String(filteredPosts.length))}</span>
		</div>
		<p class="sr-only" role="status" aria-live="polite">
			{i18n(I18nKey.postResultCount).replace("{count}", String(filteredPosts.length))}
		</p>
	{/if}
</div>

<style>
	.md3-list-container {
		/* M3 语义角色 → 项目 token 映射。刻意不引入官方默认紫色，
		   保持品牌紫（hue 275）+ 莫奈柔彩的整体语言。 */
		--md-on-surface: var(--deep-text);
		--md-on-surface-variant: var(--content-meta);
		--md-outline: var(--line-divider);
		--md-primary: var(--primary);
		--md-primary-container: color-mix(in srgb, var(--primary) 14%, var(--card-bg));

		/* 表头、选中态 chip 的文字底色是 primary-container（浅紫）而非白底，
		   --primary 压到该底只有 2.7:1，朝 deep-text 混一档才够 4.5:1。
		   deep-text 在亮色近黑、暗色近白，同一条式子两端同时修正。 */
		--md-on-primary-container: color-mix(in srgb, var(--on-primary-container) 85%, var(--deep-text));

		/* primary 直接当文字色只有 2.7:1（暗色 7.4:1 尚可，亮色不达标），
		   朝 deep-text 混 42% 后亮色 7.4:1、暗色 11.1:1，两端都稳过 AA。 */
		--md-primary-text: color-mix(in srgb, var(--primary) 42%, var(--deep-text));

		/* filled button 是「primary 底 + on-primary 字」，而本项目 primary 是浅紫，
		   白字只有 1.6:1，on-primary 必须取深色（亮色 7.2:1、暗色 8.5:1）。 */
		--md-on-primary: oklch(0.16 0.08 275);

		--md-surface-container-high: color-mix(in srgb, var(--primary) 6%, var(--card-bg));
		--md-state-layer-hover: color-mix(in srgb, var(--deep-text) 5%, transparent);

		/* 语义色当文字用时统一朝 deep-text 混一档，理由同上。
		   徽章文字底色是「语义色 15% over 行底」，比行底更饱和，
		   所以权重须低于 70%（70% 时徽章只有 4.34:1），取 55% 得 5.6:1。
		   info 同理：82% 在 surfHigh 上只剩 4.40:1，降到 72% 补齐。 */
		--md-success-text: color-mix(in srgb, var(--success) 55%, var(--deep-text));
		--md-warning-text: color-mix(in srgb, var(--warning) 55%, var(--deep-text));
		--md-info-text: color-mix(in srgb, var(--info) 72%, var(--deep-text));
		--md-destructive-text: color-mix(in srgb, var(--destructive) 88%, var(--deep-text));

		padding: 1.25rem;
		border-radius: var(--radius-large);
	}

	/* 视觉隐藏但保留给屏幕阅读器（置顶说明、标签溢出数、筛选结果播报） */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		margin-inline-start: -1px;
		overflow: hidden;
		white-space: nowrap;
	}

	/* ── 工具栏 ── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
	}

	.search-bar {
		flex: 1;
		min-width: 200px;
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 0.5rem 0 1rem;
		background: var(--md-surface-container-high);
		border-radius: 28px;
		transition: background 0.2s;
	}

	.search-bar:focus-within {
		background: color-mix(in srgb, var(--primary) 12%, var(--card-bg));
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	:global(.leading-icon) {
		font-size: 1.25rem;
		color: var(--md-on-surface-variant);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-size: 0.9375rem;
		color: var(--md-on-surface);
		padding: 0 0.5rem;
	}

	.search-input:focus {
		outline: none;
	}

	.search-input::placeholder {
		color: var(--md-on-surface-variant);
	}

	.search-input::-webkit-search-cancel-button {
		display: none;
	}

	.trailing-icon-btn {
		width: 48px;
		height: 48px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--md-on-surface-variant);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		flex-shrink: 0;
	}

	.trailing-icon-btn:hover {
		background: var(--md-state-layer-hover);
	}

	.trailing-icon-btn:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	/* M3 FilterChip */
	.filter-chips {
		display: flex;
		gap: 0.5rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		height: 40px;
		padding: 0 1rem;
		border: 1px solid var(--md-outline);
		border-radius: var(--radius-lg);
		background: transparent;
		color: var(--md-on-surface-variant);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition:
			background-color 0.18s cubic-bezier(0.2, 0, 0, 1),
			border-color 0.18s cubic-bezier(0.2, 0, 0, 1);
		overflow: hidden;
		position: relative;
	}

	.chip:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: 2px;
	}

	.chip::after {
		content: "";
		position: absolute;
		inset: 0;
		background: var(--md-state-layer-hover);
		opacity: 0;
		transition: opacity 0.15s;
		pointer-events: none;
	}

	.chip:hover::after {
		opacity: 1;
	}

	.chip.selected {
		background: var(--md-primary-container);
		border-color: transparent;
		color: var(--md-on-primary-container);
		padding-left: 0.5rem;
	}

	.chip.selected::after {
		background: color-mix(in srgb, var(--primary) 12%, transparent);
	}

	:global(.chip-check) {
		font-size: 1.125rem;
		flex-shrink: 0;
	}

	.chip-label {
		line-height: 1;
	}

	/* 计数不用 opacity 压暗——opacity 0.7 在 surfHigh 上只剩 4.12:1，
	   改用朝 deep-text 混色，亮色 8.5:1、暗色 6.8:1。 */
	.chip-count {
		font-size: 0.6875rem;
		color: color-mix(in srgb, var(--md-on-surface-variant) 35%, var(--md-on-surface));
		line-height: 1;
	}

	.chip.selected .chip-count {
		color: var(--md-on-primary-container);
	}

	.icon-text-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		height: 44px;
		padding: 0 1rem;
		border: none;
		border-radius: 22px;
		background: transparent;
		color: var(--md-primary-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
	}

	.icon-text-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	.icon-text-btn:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	.icon-text-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid color-mix(in srgb, var(--md-primary-text) 30%, transparent);
		border-top-color: var(--md-primary-text);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	/* ── 分类、标签筛选与排序 ── */
	.filter-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.select-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.select-label {
		font-size: 0.8125rem;
		color: var(--md-on-surface-variant);
		white-space: nowrap;
	}

	.select-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.select-wrap select {
		appearance: none;
		height: 40px;
		min-width: 130px;
		max-width: 220px;
		padding: 0 2rem 0 0.75rem;
		border: 1px solid var(--md-outline);
		border-radius: 8px;
		background: var(--md-surface-container-high);
		color: var(--md-on-surface);
		font-family: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
		text-overflow: ellipsis;
	}

	.select-wrap select:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: 1px;
	}

	.select-wrap select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.select-caret) {
		position: absolute;
		right: 0.5rem;
		font-size: 1.125rem;
		color: var(--md-on-surface-variant);
		pointer-events: none;
	}

	.reset-btn {
		padding: 0.5rem 1rem;
		border-radius: 20px;
	}

	/* ── 状态容器 ── */
	.state-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		text-align: center;
	}

	:global(.state-icon) {
		font-size: 3rem;
		color: var(--md-on-surface-variant);
	}

	:global(.state-icon.error) {
		color: var(--md-destructive-text);
	}

	.state-text {
		color: var(--md-on-surface-variant);
		font-size: 0.875rem;
	}

	.circular-progress {
		width: 36px;
		height: 36px;
		border: 3px solid var(--md-outline);
		border-top-color: var(--md-primary-text);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.filled-btn {
		min-height: 40px;
		padding: 0.5rem 1.5rem;
		border: none;
		border-radius: 20px;
		background: var(--md-primary);
		color: var(--md-on-primary);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: filter 0.15s;
	}

	.filled-btn:hover {
		filter: brightness(1.08);
	}

	.filled-btn:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: 2px;
	}

	.text-btn {
		min-height: 40px;
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		color: var(--md-primary-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		border-radius: 20px;
		transition: background 0.15s;
	}

	.text-btn:hover {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	.text-btn:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	/* ── 数据表 ── */
	/* 外层 .card-base 已提供容器语义，内层不再叠第二层描边圆角，
	   否则就是「卡片里再套卡片」——分隔交给行间 divider。 */
	.md3-table {
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--md-outline);
	}

	/* 表头行 */
	.header-row {
		display: grid;
		grid-template-columns: 2.5fr 1fr 1fr 1.2fr 0.9fr 1.5fr;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.header-row .col {
		padding: 0 0.25rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	/* 当前排序列给出方向箭头，aria-sort 之外的视觉冗余，
	   避免「只靠颜色/语义」传达排序状态 */
	.header-row [aria-sort="ascending"]::after {
		content: "↑";
		font-size: 0.875rem;
	}

	.header-row [aria-sort="descending"]::after {
		content: "↓";
		font-size: 0.875rem;
	}

	/* 列表项 */
	.md3-list {
		display: flex;
		flex-direction: column;
	}

	.list-item {
		display: grid;
		grid-template-columns: 2.5fr 1fr 1fr 1.2fr 0.9fr 1.5fr;
		align-items: center;
		padding: 0.75rem 1rem;
		min-height: 56px;
		transition: background 0.15s;
		cursor: default;
		position: relative;
	}

	.list-item:not(:last-child)::after {
		content: "";
		position: absolute;
		bottom: 0;
		left: 1rem;
		right: 1rem;
		height: 1px;
		background: var(--md-outline);
	}

	.list-item:hover {
		background: var(--md-state-layer-hover);
	}

	.col {
		padding: 0 0.25rem;
		min-width: 0;
	}

	/* 标题列 */
	.col-title {
		min-width: 0;
	}

	.title-cell {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.title-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}

	.pin-wrap {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	:global(.pin-icon) {
		font-size: 0.875rem;
		color: var(--md-primary-text);
		flex-shrink: 0;
	}

	.title {
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--md-on-surface);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tags {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.tag {
		padding: 0.0625rem 0.5rem;
		background: var(--md-surface-container-high);
		border-radius: 4px;
		font-size: 0.6875rem;
		color: var(--md-on-surface-variant);
	}

	.tag-more {
		font-size: 0.6875rem;
		color: var(--md-on-surface-variant);
		align-self: center;
	}

	/* 元信息文本 */
	.text-meta {
		font-size: 0.8125rem;
		color: var(--md-on-surface-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 状态徽章：图标 + 文字双通道，不靠颜色单独表意 */
	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.625rem;
		border-radius: 8px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	:global(.status-icon) {
		font-size: 0.875rem;
	}

	.status-chip[data-draft="false"] {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--md-success-text);
	}

	.status-chip[data-draft="true"] {
		background: color-mix(in srgb, var(--warning) 15%, transparent);
		color: var(--md-warning-text);
	}

	/* 操作列 - 文字按钮 */
	.text-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* 视觉紧凑但命中区撑到 44px：用伪元素外扩，不改变行的 56px 高度 */
	.text-action {
		position: relative;
		border: none;
		background: transparent;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		padding: 0.375rem 0.5rem;
		border-radius: 8px;
		transition: background-color 0.15s;
		text-decoration: none;
		font-family: inherit;
	}

	.text-action::after {
		content: "";
		position: absolute;
		inset: -0.5rem -0.25rem;
	}

	.text-action:focus-visible {
		outline: 2px solid currentcolor;
		outline-offset: 1px;
	}

	.text-action.view {
		color: var(--md-info-text);
	}

	.text-action.view:hover {
		background: color-mix(in srgb, var(--info) 12%, transparent);
	}

	.text-action.edit {
		color: var(--md-on-primary-container);
	}

	.text-action.edit:hover {
		background: color-mix(in srgb, var(--primary) 12%, transparent);
	}

	.text-action.delete {
		color: var(--md-destructive-text);
	}

	.text-action.delete:hover {
		background: color-mix(in srgb, var(--destructive) 12%, transparent);
	}

	/* Footer */
	.list-footer {
		padding: 0.75rem 1rem 0;
		text-align: right;
		color: var(--md-on-surface-variant);
		font-size: 0.75rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── 自适应：按可用宽度而非设备类别切换 ── */

	/* 中等宽度：作者/分类列先让位给标题与操作 */
	@media (max-width: 1100px) {
		.header-row,
		.list-item {
			grid-template-columns: 2.2fr 0.9fr 1.2fr 0.9fr 1.4fr;
		}

		.col-category {
			display: none;
		}
	}

	/* 紧凑宽度：表格降级为堆叠列表项，而不是拉出 700px 横向滚动条。
	   横向滚动会把「状态/操作」推到屏外，窄屏下等于隐藏关键操作。 */
	@media (max-width: 860px) {
		.toolbar {
			flex-wrap: wrap;
		}

		.toolbar-actions {
			margin-left: 0;
			width: 100%;
		}

		.icon-text-btn {
			flex: 1;
			justify-content: center;
		}

		.filter-row {
			align-items: stretch;
		}

		.select-field {
			justify-content: space-between;
			flex: 1 1 100%;
		}

		.select-wrap,
		.select-wrap select {
			flex: 1;
			max-width: none;
		}

		.filter-chips {
			overflow-x: auto;
			padding-bottom: 0.25rem;
		}

		.md3-table {
			border: none;
			border-radius: 0;
			overflow: visible;
		}

		.header-row {
			display: none;
		}

		.list-item {
			display: grid;
			grid-template-columns: 1fr auto;
			grid-template-areas:
				"title status"
				"meta  actions";
			gap: 0.5rem 0.75rem;
			padding: 1rem 0.25rem;
			min-width: 0;
		}

		.list-item:not(:last-child)::after {
			left: 0.25rem;
			right: 0.25rem;
		}

		.col-title {
			grid-area: title;
		}

		.col-status {
			grid-area: status;
			justify-self: end;
			padding: 0;
		}

		.col-author,
		.col-category,
		.col-date {
			grid-area: meta;
			grid-row: 2;
		}

		.col-author,
		.col-category {
			display: none;
		}

		.col-actions {
			grid-area: actions;
			justify-self: end;
			align-self: end;
			padding: 0;
		}

		/* 堆叠态补回表头丢失的列名 */
		.col-date::before {
			content: attr(data-label);
			font-size: 0.75rem;
			color: var(--md-on-surface-variant);
			margin-right: 0.375rem;
		}

		.title {
			white-space: normal;
			overflow-wrap: anywhere;
		}
	}
</style>

