<script lang="ts">
import { onMount } from "svelte";
import FilterPopover from "@/components/admin/FilterPopover.svelte";
import PostRowMenu from "@/components/admin/PostRowMenu.svelte";
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
	onDelete: (post: any, trigger?: HTMLElement | null) => void;
	onRefresh: () => void;
	onSync?: () => void;
	isSyncing?: boolean;
} = $props();

type SortKey = "updated" | "newest" | "oldest" | "titleAsc" | "titleDesc";

/** 参与时间排序/时间列展示所需字段 */
type TimeFields = { updated?: string | null; published?: string };

type StatusFilter = "all" | "published" | "draft";

/** 一份筛选条件快照，URL query 与 sessionStorage 共用同一形状 */
type SavedFilters = {
	q: string;
	status: StatusFilter;
	category: string;
	tag: string;
	sort: SortKey;
};

const FILTER_STORAGE_KEY = "admin_posts_filters";
const DEFAULT_SORT: SortKey = "updated";
const STATUS_VALUES = new Set<string>(["all", "published", "draft"]);
const SORT_VALUES = new Set<string>([
	"updated",
	"newest",
	"oldest",
	"titleAsc",
	"titleDesc",
]);

let searchTerm = $state("");
let statusFilter = $state<StatusFilter>("all");
let categoryFilter = $state("");
let tagFilter = $state("");
/* 默认按最近修改排：草稿没有 published，按发布时间排会全部沉底，
   「我刚写到哪」永远翻不到。 */
let sortKey = $state<SortKey>(DEFAULT_SORT);
/* 回填完成前不写回，否则刚挂载就会用默认值盖掉已保存的筛选 */
let filtersReady = $state(false);

/** 骨架行：列结构与真实行一致，只占位、不填充，加载完成后行高不变 */
const SKELETON_ROWS = [
	{ titleWidth: "78%", tags: true },
	{ titleWidth: "52%", tags: false },
	{ titleWidth: "66%", tags: true },
	{ titleWidth: "84%", tags: false },
	{ titleWidth: "44%", tags: true },
	{ titleWidth: "70%", tags: false },
];

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
	const byUpdated = (a: TimeFields, b: TimeFields) => timeOf(a) - timeOf(b);

	if (sortKey === "updated") result.sort((a, b) => byUpdated(b, a));
	else if (sortKey === "newest") result.sort((a, b) => byDate(b, a));
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

function normalizeFilters(input: Record<string, unknown>): SavedFilters {
	const status = String(input.status ?? "");
	const sort = String(input.sort ?? "");
	return {
		q: String(input.q ?? ""),
		status: STATUS_VALUES.has(status) ? (status as StatusFilter) : "all",
		category: String(input.category ?? ""),
		tag: String(input.tag ?? ""),
		sort: SORT_VALUES.has(sort) ? (sort as SortKey) : DEFAULT_SORT,
	};
}

/* 恢复顺序：URL 优先（分享链接或浏览器后退带来的参数），
   再退到 sessionStorage —— 「编辑 → 返回列表」走的是 navigate()，
   会把 query 一起冲掉，只有 sessionStorage 接得住。 */
function restoreFilters(): SavedFilters | null {
	const sp = new URLSearchParams(window.location.search);
	if (
		sp.has("q") ||
		sp.has("status") ||
		sp.has("category") ||
		sp.has("tag") ||
		sp.has("sort")
	) {
		return normalizeFilters(Object.fromEntries(sp));
	}
	try {
		const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		return normalizeFilters(parsed as Record<string, unknown>);
	} catch {
		return null;
	}
}

const SCROLL_STORAGE_KEY = "admin_posts_scroll";

/* 后台 html/body 的 overflow 被锁死，真正滚动的是右侧内容区
   （见 AdminLayout.astro 对 .admin-content 的说明） */
function scrollContainer(): HTMLElement | null {
	return document.querySelector<HTMLElement>(".admin-content");
}

function saveScroll() {
	const el = scrollContainer();
	if (!el) return;
	try {
		sessionStorage.setItem(
			SCROLL_STORAGE_KEY,
			String(Math.round(el.scrollTop)),
		);
	} catch {
		// 写入失败不影响功能
	}
}

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

/* 滚动时节流落盘：等卸载再存会踩上 .admin-content 的 class 切换
   （列表 → 编辑会加 content-wide 改宽度），那时 scrollTop 可能已被回流改动 */
function handleContentScroll() {
	if (scrollSaveTimer) return;
	scrollSaveTimer = setTimeout(() => {
		scrollSaveTimer = null;
		saveScroll();
	}, 200);
}

/* 一次性的滚动归位：列表真正渲染出来后才定位。加载态渲染的是骨架，
   行高与真实列表不同，提前定位会被 clamp 到错误位置 */
let scrollRestored = false;

$effect(() => {
	if (scrollRestored || isLoading || posts.length === 0) return;
	scrollRestored = true;
	try {
		const saved = Number(sessionStorage.getItem(SCROLL_STORAGE_KEY) || 0);
		const el = scrollContainer();
		if (saved > 0 && el) el.scrollTop = saved;
	} catch {
		// 读不到就停在顶部
	}
});

onMount(() => {
	const saved = restoreFilters();
	if (saved) {
		searchTerm = saved.q;
		statusFilter = saved.status;
		categoryFilter = saved.category;
		tagFilter = saved.tag;
		sortKey = saved.sort;
	}
	filtersReady = true;

	const el = scrollContainer();
	el?.addEventListener("scroll", handleContentScroll, { passive: true });
	/* 关闭标签页或刷新不走组件卸载，得单独兜住 */
	window.addEventListener("pagehide", saveScroll);
	return () => {
		el?.removeEventListener("scroll", handleContentScroll);
		window.removeEventListener("pagehide", saveScroll);
		if (scrollSaveTimer) {
			clearTimeout(scrollSaveTimer);
			scrollSaveTimer = null;
		}
		saveScroll();
	};
});

/* 筛选一变就同时落两处：URL 用 replaceState（不产生历史记录，后退键不会
   被每次输入打乱），sessionStorage 负责 navigate() 跳转后的恢复。
   默认值不写进 URL，保证地址栏干净。 */
$effect(() => {
	if (!filtersReady) return;
	const saved: SavedFilters = {
		q: searchTerm,
		status: statusFilter,
		category: categoryFilter,
		tag: tagFilter,
		sort: sortKey,
	};
	try {
		sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(saved));
	} catch {
		// 隐私模式等场景写不进去，忽略即可
	}
	const sp = new URLSearchParams();
	if (saved.q) sp.set("q", saved.q);
	if (saved.status !== "all") sp.set("status", saved.status);
	if (saved.category) sp.set("category", saved.category);
	if (saved.tag) sp.set("tag", saved.tag);
	if (saved.sort !== DEFAULT_SORT) sp.set("sort", saved.sort);
	const query = sp.toString();
	const next = window.location.pathname + (query ? `?${query}` : "");
	const current = window.location.pathname + window.location.search;
	if (next !== current) history.replaceState(history.state, "", next);
});

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/* 排序用的统一时间戳：优先 updated，取不到退回 published。
   Date.parse 失败返回 NaN（假值），|| 因此自然落到下一支。 */
function timeOf(post: TimeFields): number {
	return (
		Date.parse(post.updated || "") || Date.parse(post.published || "") || 0
	);
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

/* 日期列的表头与单元格都要跟随排序字段：按「最近修改」排序却显示发布日期，
   列表看上去是乱序的。 */
const dateColLabel = $derived(
	sortKey === "updated"
		? i18n(I18nKey.postSortUpdated)
		: i18n(I18nKey.postColDate),
);

function dateShown(post: TimeFields): string {
	const raw =
		sortKey === "updated" ? post.updated || post.published : post.published;
	return raw ? formatDate(raw) : "—";
}

function actionLabel(action: string, title: string): string {
	return i18n(I18nKey.postActionLabel)
		.replace("{action}", action)
		.replace("{title}", title);
}
</script>

<div class="md3-list-container card-base">
	<!-- 状态筛选（第一行，对齐参考项目 post-list-tabs） -->
	<div class="filter-chips" role="group" aria-label={i18n(I18nKey.postStatusFilterGroup)}>
		<button
			class="chip"
			class:selected={statusFilter === "all"}
			aria-pressed={statusFilter === "all"}
			onclick={() => (statusFilter = "all")}
		>
			<span class="chip-label">{i18n(I18nKey.postAll)}</span>
			<span class="chip-count">{posts.length}</span>
		</button>
		<button
			class="chip"
			class:selected={statusFilter === "published"}
			aria-pressed={statusFilter === "published"}
			onclick={() => (statusFilter = "published")}
		>
			<span class="chip-label">{i18n(I18nKey.postPublished)}</span>
			<span class="chip-count">{posts.filter((p) => !p.draft).length}</span>
		</button>
		<button
			class="chip"
			class:selected={statusFilter === "draft"}
			aria-pressed={statusFilter === "draft"}
			onclick={() => (statusFilter = "draft")}
		>
			<span class="chip-label">{i18n(I18nKey.postDraft)}</span>
			<span class="chip-count">{posts.filter((p) => p.draft).length}</span>
		</button>
	</div>

	<!-- 工具栏（第二行） -->
	<div class="toolbar">
		<div class="search-bar">
			<Icon icon="material-symbols:search" class="leading-icon" />
			<input
				type="search"
				bind:value={searchTerm}
				placeholder={i18n(I18nKey.postSearchPlaceholder)}
				aria-label={i18n(I18nKey.postSearchLabel)}
				class="search-input"
				data-post-list-search
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

		<!-- 排序：与搜索同行常驻，随时切视图角度（对齐参考项目 post-list-sort） -->
		<label class="toolbar-sort">
			<span class="sort-label">{i18n(I18nKey.postSort)}</span>
			<div class="select-wrap">
				<select bind:value={sortKey} aria-label={i18n(I18nKey.postSort)}>
					<option value="updated">{i18n(I18nKey.postSortUpdated)}</option>
					<option value="newest">{i18n(I18nKey.postSortNewest)}</option>
					<option value="oldest">{i18n(I18nKey.postSortOldest)}</option>
					<option value="titleAsc">{i18n(I18nKey.postSortTitleAsc)}</option>
					<option value="titleDesc">{i18n(I18nKey.postSortTitleDesc)}</option>
				</select>
				<Icon icon="material-symbols:expand-more" class="select-caret" />
			</div>
		</label>

		<div class="toolbar-actions">
			<FilterPopover
				{categories}
				{tags}
				{categoryFilter}
				{tagFilter}
				onCategoryChange={(value) => (categoryFilter = value)}
				onTagChange={(value) => (tagFilter = value)}
			/>

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

	<!-- 分类栏（表头） -->
	{#snippet headerRow()}
		<div class="header-row" role="rowgroup">
			<div class="col col-title" role="columnheader" aria-sort={ariaSortFor("title")}>
				{i18n(I18nKey.postColTitle)}
			</div>
			<div class="col col-author" role="columnheader">{i18n(I18nKey.postColAuthor)}</div>
			<div class="col col-category" role="columnheader">{i18n(I18nKey.postColCategory)}</div>
			<div class="col col-date" role="columnheader" aria-sort={ariaSortFor("date")}>
				{dateColLabel}
			</div>
			<div class="col col-status" role="columnheader">{i18n(I18nKey.postColStatus)}</div>
			<div class="col col-actions" role="columnheader">{i18n(I18nKey.postColActions)}</div>
		</div>
	{/snippet}

	<!-- 列表内容 -->
	{#if error}
		<div class="state-container" role="alert">
			<Icon icon="material-symbols:error-outline" class="state-icon error" />
			<p class="state-text" id="post-list-error">{error}</p>
			<button class="filled-btn" onclick={onRefresh} aria-describedby="post-list-error">
				{i18n(I18nKey.postRetry)}
			</button>
		</div>
	{:else if !isLoading && filteredPosts.length === 0}
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
		<div
			class="md3-table"
			role="table"
			aria-label={i18n(I18nKey.postTableLabel)}
			aria-busy={isLoading}
		>
			{@render headerRow()}

			{#if isLoading}
				<div class="md3-list skeleton-list" role="rowgroup" aria-hidden="true">
					{#each SKELETON_ROWS as row, i (i)}
						<div class="list-item" role="row">
							<div class="col col-title" role="cell">
								<div class="title-cell">
									<div class="title-row">
										<span class="sk sk-title" style:width={row.titleWidth}></span>
									</div>
									{#if row.tags}
										<div class="tags">
											<span class="sk sk-tag"></span>
											<span class="sk sk-tag short"></span>
										</div>
									{/if}
								</div>
							</div>
							<div class="col col-author" role="cell"><span class="sk sk-line"></span></div>
							<div class="col col-category" role="cell"><span class="sk sk-line short"></span></div>
							<div class="col col-date" role="cell"><span class="sk sk-line"></span></div>
							<div class="col col-status" role="cell"><span class="sk sk-chip"></span></div>
							<div class="col col-actions" role="cell">
								<div class="icon-actions">
									<span class="sk sk-dot"></span>
									<span class="sk sk-dot"></span>
									<span class="sk sk-dot"></span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
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
											<span class="tag">#{tag}</span>
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

						<!-- 发布/修改日期，跟随当前排序字段 -->
						<div class="col col-date" role="cell" data-label={dateColLabel}>
							<span class="text-meta">{dateShown(post)}</span>
						</div>

						<!-- 状态 -->
						<div class="col col-status" role="cell" data-label={i18n(I18nKey.postColStatus)}>
							<span class="status-chip" data-draft={post.draft}>
								<span class="status-dot" aria-hidden="true"></span>
								{post.draft ? i18n(I18nKey.postDraft) : i18n(I18nKey.postPublished)}
							</span>
						</div>

						<!-- 操作（图标按钮） -->
						<div class="col col-actions" role="cell" data-label={i18n(I18nKey.postColActions)}>
							<div class="icon-actions">
								<a
									class="icon-action view"
									href={`/posts/${post.slug}`}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={actionLabel(i18n(I18nKey.postView), post.title)}
									title={i18n(I18nKey.postView)}
								>
									<Icon icon="material-symbols:visibility-outline-rounded" class="action-icon" />
								</a>
								<button
									class="icon-action edit"
									onclick={() => onEdit(post)}
									aria-label={actionLabel(i18n(I18nKey.postEdit), post.title)}
									title={i18n(I18nKey.postEdit)}
								>
									<Icon icon="material-symbols:edit" class="action-icon" />
								</button>
								<PostRowMenu
									title={post.title}
									onDelete={(trigger) => onDelete(post, trigger)}
								/>
							</div>
						</div>
					</div>
				{/each}
			</div>
			{/if}
		</div>

		{#if isLoading}
			<p class="sr-only" role="status" aria-live="polite">
				{i18n(I18nKey.postLoading)}
			</p>
		{:else}
			<div class="list-footer">
				<span>{i18n(I18nKey.postListCount).replace("{count}", String(filteredPosts.length))}</span>
				{#if hasExtraFilter}
					<button type="button" class="footer-reset" onclick={clearAllFilters}>
						{i18n(I18nKey.postClearFilter)}
					</button>
				{/if}
			</div>
			<p class="sr-only" role="status" aria-live="polite">
				{i18n(I18nKey.postResultCount).replace("{count}", String(filteredPosts.length))}
			</p>
		{/if}
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
		/* 行悬停单独一档：行面积大、需要比小控件（5%）更明确的反馈，
		   8% 实测红通道偏移 15%，清晰可见但仍克制。 */
		--md-row-hover: color-mix(in srgb, var(--deep-text) 8%, transparent);

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

		/* 统一控件规格：工具栏内所有控件共用高度、圆角、间距。
		   此前搜索框 48px / 按钮 44px / chip 40px 三种高度、28/22/20/8px 四种圆角
		   混排，视觉上参差不齐，这里收敛为一套 token。
		   圆角取 10px 方角而非胶囊：与参考项目（flare-stack-blog）后台
		   post-manager 的控件圆角一致，40px 高配 10px 圆角是方形按钮观感。 */
		--md-control-h: 40px;
		--md-control-r: 10px;
		--md-control-gap: 0.5rem;
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
		gap: var(--md-control-gap);
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: var(--md-control-gap);
		margin-left: auto;
	}

	.search-bar {
		flex: 1;
		min-width: 200px;
		display: flex;
		align-items: center;
		height: var(--md-control-h);
		padding: 0 0.25rem 0 0.875rem;
		background: var(--md-surface-container-high);
		border-radius: var(--md-control-r);
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

	/* 视觉 40px 与搜索框等高，命中区用伪元素外扩到 48dp，
	   避免撑破搜索框又保住触控目标 */
	.trailing-icon-btn {
		position: relative;
		width: var(--md-control-h);
		height: var(--md-control-h);
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--md-on-surface-variant);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		flex-shrink: 0;
	}

	.trailing-icon-btn::after {
		content: "";
		position: absolute;
		inset: -4px;
		border-radius: 10px;
	}

	.trailing-icon-btn:hover {
		background: var(--md-state-layer-hover);
	}

	.trailing-icon-btn:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	/* 状态筛选（第一行）：文字下划线 tab，对齐参考项目 post-list-tabs。
   不做等宽——译文长短不齐时按内容自然宽度排，选中项靠 2px 主色
   底线指示，容器自带一条 1px 分隔线。 */
	.filter-chips {
		display: flex;
		align-items: center;
		gap: 2rem;
		border-bottom: 1px solid var(--md-outline);
		margin-bottom: 0.75rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.875rem;
		padding: 0 0.375rem;
		border: none;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: var(--md-on-surface-variant);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.chip:hover {
		color: var(--md-primary-text);
	}

	.chip:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: 2px;
	}

	.chip.selected {
		border-bottom-color: var(--md-primary-text);
		color: var(--md-primary-text);
	}

	.chip-label {
		line-height: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 计数继承 tab 文字色，选中时随主色一起变亮 */
	.chip-count {
		font-size: 0.8125rem;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	:global(.icon-text-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		height: var(--md-control-h);
		padding: 0 1rem;
		border: none;
		border-radius: var(--md-control-r);
		background: transparent;
		color: var(--md-primary-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
	}

	:global(.icon-text-btn):hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	:global(.icon-text-btn):focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	:global(.icon-text-btn):disabled {
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

	/* ── 排序：常驻工具栏，label + select 同高同轴 ── */
	.toolbar-sort {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.sort-label {
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
		height: var(--md-control-h);
		min-width: 130px;
		max-width: 220px;
		padding: 0 2rem 0 0.875rem;
		border: 1px solid var(--md-outline);
		border-radius: var(--md-control-r);
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
		right: 0.875rem;
		font-size: 1.125rem;
		color: var(--md-on-surface-variant);
		pointer-events: none;
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

	/* 加载骨架：占位块与真实行共用 .list-item 的列网格与 min-height，
	   列宽行高在加载前后不变，内容到位时页脚与下方内容不位移。
	   底色用 on-surface 与透明度混色，明暗主题下分层方向自动正确。 */
	.sk {
		display: block;
		background: color-mix(in srgb, var(--md-on-surface) 12%, transparent);
		border-radius: 6px;
		animation: skPulse 1.4s ease-in-out infinite;
	}

	.sk-title {
		max-width: 100%;
		height: 20px;
	}

	.sk-tag {
		width: 48px;
		height: 14px;
		border-radius: 4px;
	}

	.sk-tag.short {
		width: 32px;
	}

	.sk-line {
		width: 80%;
		height: 12px;
	}

	.sk-line.short {
		width: 55%;
	}

	.sk-chip {
		width: 56px;
		height: 20px;
	}

	.sk-dot {
		width: 34px;
		height: 34px;
		border-radius: 50%;
	}

	/* 占位行没有可点内容，响应 hover 会让人以为它能点 */
	.skeleton-list .list-item:hover {
		background: none;
	}

	@keyframes skPulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}

	.filled-btn {
		height: var(--md-control-h);
		padding: 0 1.5rem;
		border: none;
		border-radius: var(--md-control-r);
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: var(--md-control-h);
		padding: 0 1rem;
		border: none;
		background: transparent;
		color: var(--md-primary-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		border-radius: var(--md-control-r);
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
	/* 表格容器
	   圆角从 radius-md(6px) 提到 radius-large(16px)：6px 在 70px 行高下显得生硬，
	   16px 贴近 MD3 卡片圆角，和外层容器内边距（1.25rem）不冲突。 */
	.md3-table {
		border-radius: var(--radius-large);
		overflow: hidden;
		border: 1px solid var(--md-outline);
	}

	/* 表头行
	   底色用 on-surface 混入 card-bg：方向随主题自动正确 —— 亮色下 on-surface 是
	   深色，表头因此比正文行更深；暗色下是近白，表头凸起更亮，两个主题都能与正文
	   明确分层。不用「叠黑」是因为暗色下叠黑会让表头底趋近纯黑、反而更贴近卡片底。
	   再叠一条下边框，字号/字重/字距/大写同时收敛，分层不只依赖底色。 */
	.header-row {
		display: grid;
		grid-template-columns: 2.9fr 0.9fr 0.9fr 1.1fr 0.9fr 1.2fr;
		align-items: center;
		padding: 0.875rem 1rem;
		background: color-mix(in srgb, var(--md-on-surface) 10%, var(--card-bg));
		border-bottom: 1px solid var(--md-outline);
		color: var(--md-on-surface-variant);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
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

	/* 列表项
	   行高约 63px → 70px：标题 + 标签两行内容原本挤在 12px 上下内边距里，
	   上下留白不足让相邻行视觉粘连。padding 取 1rem 而非 1.125rem，
	   使「有标签」与「无标签」两种行高都落在 70~71px，整列不被个别行撑歪。 */
	.list-item {
		display: grid;
		grid-template-columns: 2.9fr 0.9fr 0.9fr 1.1fr 0.9fr 1.2fr;
		align-items: center;
		padding: 1rem;
		min-height: 70px;
		transition: background 0.15s;
		cursor: default;
	}

	/* 行间分割线已移除，改为纯靠 70px 行高 + 悬停高亮分隔。
   除了视觉更透气，保留分割线还有个实际问题：它不会跟随悬停变色，
   鼠标扫过一行时横线仍是原色，把高亮区切成两段，悬停反馈显得破碎。 */
	.list-item:hover {
		background: var(--md-row-hover);
	}

	.col {
		padding: 0 0.25rem;
		min-width: 0;
	}

	/* 标题列 */
	.col-title {
		min-width: 0;
	}

	/* 操作列额外右内边距：仅靠 .list-item 的 1rem 容器留白时，
	   图标组仍显得贴边，这里补一档并让按钮在该列内居中。 */
	.col-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-right: 0.75rem;
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

	/* 标题是列表的视觉锚点：加大加粗，并用 on-surface（暗色下接近纯白），
	   亮色主题下 on-surface 是深色，符合「最亮/最重」的层级意图而非硬编码纯白。 */
	.title {
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--md-on-surface);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tags {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: baseline;
	}

	/* 标签退为灰色纯文本（#tag），去掉背景色块、圆角与内边距：
	   多色方块在一屏内互相竞争注意力，弱化后标题层级才立得住。
	   颜色沿用 on-surface-variant（不再额外压暗）——标签已是 12px 小字，
	   继续压到 4.5:1 以下会牺牲可读性，弱化交给「去色块 + 缩小」即可。 */
	.tag {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--md-on-surface-variant);
		letter-spacing: 0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tag-more {
		font-size: 0.75rem;
		color: var(--md-on-surface-variant);
		align-self: center;
	}

	/* 元信息文本（作者/分类/日期）
	   调小到 12px，与 17px/600 的标题拉开两级字号层级。
	   颜色沿用 on-surface-variant 不再压暗，也不用 opacity：opacity 会连带
	   拉低与卡片的实际对比度（项目此前在 chip-count 上实测 0.7 只剩 4.12:1），
	   12px 小字必须守住 4.5:1，弱化交给字号而非明度。 */
	.text-meta {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--md-on-surface-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 状态徽章：圆点 + 文字
	   原先「勾/编辑笔记」图标把状态列撑到约 83px，收窄为 6px 圆点后降到约 70px。
   圆角取 6px（radius-md）而非 999px 胶囊：徽章高度仅 20px，胶囊过于圆润，
   6px 与表格容器 16px 的圆角语言更协调，也避免一排胶囊抢走标题的注意力。
   语义仍由文字承载（圆点是纯装饰），未退化为「只靠颜色表意」。 */
	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.1875rem 0.5rem;
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
		background: currentcolor;
	}

	.status-chip[data-draft="false"] {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--md-success-text);
	}

	.status-chip[data-draft="true"] {
		background: color-mix(in srgb, var(--warning) 15%, transparent);
		color: var(--md-warning-text);
	}

	/* 操作列 - 图标按钮
	   文字按钮退到图标后，红色「删除」不再抢占整行视线，删除与编辑之间也有独立
	   命中区（原先两个纯文本按钮相邻，容易误点）。视觉 34px + 伪元素外扩到 44dp，
	   触控目标达标又不撑高行。 */
	/* 操作列 - 图标按钮
	   查看/编辑保持常驻，删除收进 PostRowMenu 的 ··· 菜单：红色删除不再抢占整行
	   视线，也不再与编辑相邻留下直接命中区。视觉 34px + 伪元素外扩到 44dp，
	   触控目标达标又不撑高行。
	   .icon-action 一族写成 :global —— ··· 触发器在 PostRowMenu 里，要同一副形状。 */
	.icon-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		/* 12px 间距 + 伪元素外扩 4px：命中区之间净留 4px 间隙。
		   原先 gap 4px 配外扩 5px，相邻命中区反而重叠 6px，确易误点。 */
		gap: 0.75rem;
	}

	:global(.icon-action) {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--md-on-surface-variant);
		cursor: pointer;
		text-decoration: none;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	/* 命中区外扩到 42dp：与 12px 间距配合后相邻命中区不重叠（净间隙 4px），
	   既保住触控目标又不会让两个按钮的热区串在一起 */
	:global(.icon-action::after) {
		content: "";
		position: absolute;
		inset: -4px;
		border-radius: 10px;
	}

	:global(.icon-action:hover) {
		background: var(--md-state-layer-hover);
		color: var(--md-on-surface);
	}

	:global(.icon-action:focus-visible) {
		outline: 2px solid currentcolor;
		outline-offset: 1px;
	}

	:global(.action-icon) {
		font-size: 1.25rem;
	}

	/* 悬停时才显出语义色，静止状态两枚图标同为中性灰 */
	.icon-action.view:hover {
		background: color-mix(in srgb, var(--info) 14%, transparent);
		color: var(--md-info-text);
	}

	.icon-action.edit:hover {
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		color: var(--md-primary-text);
	}

	/* Footer */
	.list-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem 0;
		color: var(--md-on-surface-variant);
		font-size: 0.75rem;
	}

	.footer-reset {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm, 0.375rem);
		background: transparent;
		color: var(--md-primary-text);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.footer-reset:hover {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	.footer-reset:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
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
			grid-template-columns: 2.6fr 0.9fr 1.1fr 0.9fr 1.2fr;
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

		/* 窄屏下 tab 不被压扁，超出部分横向滚动 */
		.filter-chips {
			flex-wrap: nowrap;
			min-width: 0;
			overflow-x: auto;
			padding-bottom: 0.25rem;
		}

		.toolbar-actions {
			margin-left: 0;
			width: 100%;
		}

		:global(.icon-text-btn) {
			flex: 1;
			justify-content: center;
		}

		/* 排序整行占满，select 跟着拉宽 */
		.toolbar-sort {
			flex: 1 1 100%;
		}

		.toolbar-sort .select-wrap,
		.toolbar-sort .select-wrap select {
			flex: 1;
			max-width: none;
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
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				"title status"
				"meta  actions";
			align-items: center;
			gap: 0.625rem 0.75rem;
			padding: 1.125rem 0.25rem;
			min-width: 0;
		}

		.col-title {
			grid-area: title;
			align-self: center;
		}

		.col-status {
			grid-area: status;
			justify-self: end;
			align-self: center;
			padding: 0;
		}

		.col-date {
			grid-area: meta;
			align-self: center;
		}

		.col-author,
		.col-category {
			display: none;
		}

		.col-actions {
			grid-area: actions;
			justify-self: end;
			align-self: center;
			padding: 0;
			width: 100%;
			max-width: 220px;
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

