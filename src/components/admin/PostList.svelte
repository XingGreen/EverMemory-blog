<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { siteConfig } from "@/config/siteConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AdminPostSummary } from "@/types/adminApi";
import Select from "./Select.svelte";

let {
	posts,
	isLoading,
	error,
	onEdit,
	onRefresh,
	onCreate,
	onSync,
	onOpenDiff,
	onOpenSync,
	isSyncing = false,
	heading,
}: {
	posts: AdminPostSummary[];
	isLoading: boolean;
	error: string;
	onEdit: (post: AdminPostSummary) => void;
	onRefresh: () => void;
	onCreate: () => void;
	onSync?: () => void;
	/** 跳转到独立差异页，由上层注入路由 */
	onOpenDiff?: (slug: string) => void;
	/** 打开同步工作台 */
	onOpenSync?: () => void;
	isSyncing?: boolean;
	/** 是否渲染自带页头。默认 true（独立使用）；
	 *  套进 AdminPage 时传 false，页头由外壳的 title/actions 承担。 */
	heading?: boolean;
} = $props();

/** 同步面板开关：点「同步文章」打开专门的面板，不再直接触发同步 */

const showHeading = $derived(heading !== false);

type SortKey = "updated" | "newest" | "oldest" | "titleAsc" | "titleDesc";

/** 参与时间排序/时间列展示所需字段 */
type TimeFields = { updated?: string | null; published?: string };

type StatusFilter = "all" | "published" | "draft" | "unsynced";

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
const STATUS_VALUES = new Set<string>([
	"all",
	"published",
	"draft",
	"unsynced",
]);
const SORT_VALUES = new Set<string>([
	"updated",
	"newest",
	"oldest",
	"titleAsc",
	"titleDesc",
]);

let searchTerm = $state("");
let statusFilter = $state<StatusFilter>("all");

/* ── 行右侧账目栏 ──
   一列校样 + 一条页边账：状态与时间靠右成栏，取代原先「日期」「状态」两列。
   分类与扩展名降级为标题下那行的尾注，不再是独立列。 */
type RailState = {
	label: string;
	/* attention = 需要你动手（待部署 / 未同步）；palette 里只有它会用主色 */
	tone: "attention" | "draft" | "plain";
	hint?: string;
};

function railState(post: AdminPostSummary): RailState {
	if (post.draft) {
		return { label: i18n(I18nKey.postDraft), tone: "draft" };
	}
	if (post.syncState === "pending-deploy") {
		return {
			label: i18n(I18nKey.postSyncPendingDeploy),
			tone: "attention",
			hint: i18n(I18nKey.postSyncPendingDeployHint),
		};
	}
	if (post.syncState === "not-on-github") {
		return { label: i18n(I18nKey.postSyncNotOnGithub), tone: "attention" };
	}
	return { label: i18n(I18nKey.postPublished), tone: "plain" };
}

/* 相对时间交给 Intl：五套语言自带词形（「昨天」「3 日前」「last week」），
   不必为它新增 i18n 词条。locale 取站点语言，下划线换连字符。 */
const RELATIVE_LOCALE = (siteConfig.lang || "en")
	.replace(/_/g, "-")
	.toLowerCase();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function timeAgo(post: TimeFields): string {
	const ts = timeOf(post);
	if (!ts) return "—";
	const diff = ts - Date.now();
	const abs = Math.abs(diff);
	const rtf = new Intl.RelativeTimeFormat(RELATIVE_LOCALE, { numeric: "auto" });
	if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
	if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
	if (abs < WEEK) return rtf.format(Math.round(diff / DAY), "day");
	if (abs < MONTH) return rtf.format(Math.round(diff / WEEK), "week");
	if (abs < YEAR) return rtf.format(Math.round(diff / MONTH), "month");
	return rtf.format(Math.round(diff / YEAR), "year");
}

/* 悬停时用 title 给出精确时间：相对时间好读，但不能用来核对 */
function absoluteTime(post: TimeFields): string {
	const raw = post.updated || post.published;
	return raw ? formatDate(raw) : "";
}

function fileExt(post: AdminPostSummary): string {
	return post.filePath.slice(post.filePath.lastIndexOf(".")) || "";
}

let categoryFilter = $state("");
let tagFilter = $state("");
/* 默认按最近修改排：草稿没有 published，按发布时间排会全部沉底，
   「我刚写到哪」永远翻不到。 */
let sortKey = $state<SortKey>(DEFAULT_SORT);
/* 回填完成前不写回，否则刚挂载就会用默认值盖掉已保存的筛选 */
let filtersReady = $state(false);

/** 骨架行：列结构与真实行一致，只占位、不填充，加载完成后行高不变 */
const SKELETON_ROWS = [
	{ titleWidth: "78%", intro: true },
	{ titleWidth: "52%", intro: false },
	{ titleWidth: "66%", intro: true },
	{ titleWidth: "84%", intro: false },
	{ titleWidth: "44%", intro: true },
	{ titleWidth: "70%", intro: false },
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

/* 同步状态统计：pending-deploy = 已提交 GitHub 但还没进这次构建；
   not-on-github = 构建里有、GitHub 上找不到（未推送，或远端已删）。
   API 拿不到远端清单时 syncState 为 null，两个计数都是 0，界面不显示。 */
const pendingDeployCount = $derived(
	posts.filter((post) => post.syncState === "pending-deploy").length,
);
const notOnGithubCount = $derived(
	posts.filter((post) => post.syncState === "not-on-github").length,
);
const unsyncedCount = $derived(pendingDeployCount + notOnGithubCount);

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
	} else if (statusFilter === "unsynced") {
		/* 「未同步」= 尚未提交到 GitHub（not-on-github），或已提交但当前部署产物
		   还没带上（pending-deploy）。远端清单取不到时 syncState 为 null，此时
		   不并入本筛选，避免整表被误判为未同步。 */
		result = result.filter(
			(post) =>
				post.syncState === "pending-deploy" ||
				post.syncState === "not-on-github",
		);
	}

	if (categoryFilter) {
		result = result.filter((post) => post.category === categoryFilter);
	}

	if (tagFilter) {
		result = result.filter((post) => post.tags.includes(tagFilter));
	}

	const byTitle = (a: AdminPostSummary, b: AdminPostSummary) =>
		a.title.localeCompare(b.title, "zh-CN");
	const byDate = (a: AdminPostSummary, b: AdminPostSummary) =>
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

function actionLabel(action: string, title: string): string {
	return i18n(I18nKey.postActionLabel)
		.replace("{action}", action)
		.replace("{title}", title);
}
</script>

<div class="md3-list-container">
	<!-- 页头：标题、状态轨、搜索、操作同一条基线。
	     日期与状态已移入每行右侧的账目栏，所以这里不再需要筛选条 + 工具栏 +
	     表头三层 chrome；第一篇文章的位置从 331px 提到了一百多像素。 -->
	<div class="masthead">
		<h1 class="masthead-title">{i18n(I18nKey.adminPosts)}</h1>

		<div class="rail-filter" role="group" aria-label={i18n(I18nKey.postStatusFilterGroup)}>
			<button
				class="rail-btn"
				class:selected={statusFilter === "all"}
				aria-pressed={statusFilter === "all"}
				onclick={() => (statusFilter = "all")}
			>
				{i18n(I18nKey.postAll)}<span class="rail-count">{posts.length}</span>
			</button>
			<button
				class="rail-btn"
				class:selected={statusFilter === "published"}
				aria-pressed={statusFilter === "published"}
				onclick={() => (statusFilter = "published")}
			>
				{i18n(I18nKey.postPublished)}<span class="rail-count"
					>{posts.filter((p) => !p.draft).length}</span
				>
			</button>
			<button
				class="rail-btn"
				class:selected={statusFilter === "draft"}
				aria-pressed={statusFilter === "draft"}
				onclick={() => (statusFilter = "draft")}
			>
				{i18n(I18nKey.postDraft)}<span class="rail-count"
					>{posts.filter((p) => p.draft).length}</span
				>
			</button>
			<!-- 未同步：涵盖「尚未提交到 GitHub」与「已提交但未部署」两种，计数取两者之和 -->
			<button
				class="rail-btn"
				class:selected={statusFilter === "unsynced"}
				class:attention={unsyncedCount > 0}
				aria-pressed={statusFilter === "unsynced"}
				onclick={() => (statusFilter = "unsynced")}
			>
				{i18n(I18nKey.postUnsynced)}<span class="rail-count">{unsyncedCount}</span>
			</button>
		</div>

		<div class="masthead-spacer"></div>

		<div class="ui-search search-bar">
			<Icon icon="material-symbols:search" class="ui-search-icon" />
			<input
				type="search"
				bind:value={searchTerm}
				placeholder={i18n(I18nKey.postSearchPlaceholder)}
				aria-label={i18n(I18nKey.postSearchLabel)}
				class="ui-search-input"
				data-post-list-search
			/>
			{#if searchTerm}
				<button
					class="ui-search-clear"
					onclick={() => (searchTerm = "")}
					aria-label={i18n(I18nKey.postSearchClear)}
				>
					<Icon icon="material-symbols:close" />
				</button>
			{/if}
		</div>

		{#if onSync}
			<button
				class="ui-btn ui-btn-soft masthead-sync"
				onclick={() => onOpenSync?.()}
				disabled={isLoading || isSyncing}
				aria-label={i18n(I18nKey.postSyncNow)}
			>
				<Icon icon="material-symbols:cloud" class="btn-icon" />
				<span class="btn-label"
					>{isSyncing ? i18n(I18nKey.postSyncing) : i18n(I18nKey.postSyncNow)}</span
				>
			</button>
		{/if}

		<button class="ui-btn ui-btn-primary masthead-create" onclick={onCreate}>
			<Icon icon="material-symbols:add" class="btn-icon" />
			<span class="btn-label">{i18n(I18nKey.adminNewPost)}</span>
		</button>
	</div>

	<!-- 筛选：常驻但安静，三个紧凑控件，不带分隔线——页头那条已经划分了区域 -->
	<div class="filter-row">
		<label class="filter-field">
			<span class="filter-label">{i18n(I18nKey.postFilterCategory)}</span>
			<Select
				value={categoryFilter}
				options={[
					{ value: "", label: i18n(I18nKey.postAll) },
					...categories.map((c) => ({ value: c, label: c })),
				]}
				onChange={(v) => (categoryFilter = v)}
				disabled={categories.length === 0}
			/>
		</label>

		<label class="filter-field">
			<span class="filter-label">{i18n(I18nKey.postFilterTag)}</span>
			<Select
				value={tagFilter}
				options={[
					{ value: "", label: i18n(I18nKey.postAll) },
					...tags.map((t) => ({ value: t, label: t })),
				]}
				onChange={(v) => (tagFilter = v)}
				disabled={tags.length === 0}
			/>
		</label>

		<label class="filter-field">
			<span class="filter-label">{i18n(I18nKey.postSort)}</span>
			<Select
				value={sortKey}
				options={[
					{ value: "updated", label: i18n(I18nKey.postSortUpdated) },
					{ value: "newest", label: i18n(I18nKey.postSortNewest) },
					{ value: "oldest", label: i18n(I18nKey.postSortOldest) },
					{ value: "titleAsc", label: i18n(I18nKey.postSortTitleAsc) },
					{ value: "titleDesc", label: i18n(I18nKey.postSortTitleDesc) },
				]}
				onChange={(v) => (sortKey = v as typeof sortKey)}
			/>
		</label>

		{#if hasExtraFilter}
			<button class="filter-reset" type="button" onclick={clearAllFilters}>
				{i18n(I18nKey.postClearFilter)}
			</button>
		{/if}
	</div>

	<!-- 唯一的滚动区：错误 / 空态 / 列表 / 页脚都装在这里 -->
	<div class="list-scroll">
	<!-- 列表内容 -->
	{#if error}
		<div class="state-container" role="alert">
			<Icon icon="material-symbols:error-outline" class="state-icon error" />
			<p class="state-text" id="post-list-error">{error}</p>
			<button class="ui-btn ui-btn-soft" onclick={onRefresh} aria-describedby="post-list-error">
				{i18n(I18nKey.postRetry)}
			</button>
		</div>
	{:else if !isLoading && filteredPosts.length === 0}
		<div class="state-container">
			<Icon icon="material-symbols:folder-open" class="state-icon" />
			<p class="state-text">{hasExtraFilter ? i18n(I18nKey.postNoMatch) : i18n(I18nKey.postNoPosts)}</p>
			{#if hasExtraFilter}
				<button class="ui-btn ui-btn-ghost" onclick={clearAllFilters}>
					{i18n(I18nKey.postClearFilter)}
				</button>
			{:else}
				<!-- 一篇都没有的时候，唯一有意义的下一步是写第一篇 -->
				<button class="ui-btn ui-btn-primary" onclick={onCreate}>
					<Icon icon="material-symbols:add" class="btn-icon" />
					{i18n(I18nKey.adminNewPost)}
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
			{#if isLoading}
				<div class="md3-list skeleton-list" role="rowgroup" aria-hidden="true">
					{#each SKELETON_ROWS as row, i (i)}
						<div class="list-item" role="row">
							<div class="row-body" role="cell">
								<span class="sk sk-title" style:width={row.titleWidth}></span>
								{#if row.intro}
									<span class="sk sk-intro"></span>
								{/if}
							</div>
							<div class="row-side" role="cell">
								<span class="sk sk-line short"></span>
								<span class="sk sk-line tiny"></span>
							</div>
						</div>
					{/each}
				</div>
			{:else}
			<!-- 列表项：一列校样 + 右侧一条账目栏。日期与状态不再是列，而是页边的一行账。 -->
			<div class="md3-list" role="rowgroup">
				{#each filteredPosts as post (post.id)}
					{@const rail = railState(post)}
					<div class="list-item" role="row">
						<div class="row-body" role="cell" data-label={i18n(I18nKey.postColTitle)}>
							<span class="title-line">
								<span class="title" title={post.title}>{post.title}</span>
								{#if post.pinned}
									<Icon icon="material-symbols:push-pin" class="pin-icon" />
									<span class="sr-only">{i18n(I18nKey.postPinned)}</span>
								{/if}
								{#if post.password}
									<Icon icon="material-symbols:lock-outline" class="lock-icon" />
								{/if}
							</span>
							<span class="intro" title={post.description || post.slug}>
								{post.description || post.slug}
							</span>
									<!-- 归档信息单独一层：分类与扩展名是「这篇归在哪儿」，
									     不能和摘要共享一行行文 -->
									<span class="meta-line">
										{#if post.category}
											<span class="meta-cat">{post.category}</span>
										{/if}
										<span class="meta-ext">{fileExt(post)}</span>
									</span>
						</div>

						<!-- 账目栏：状态在上、时间在下，都是等宽；悬停时整栏让给动作 -->
						<div class="col row-side" role="cell">
							<div class="ledger">
								<span class="ledger-state" data-tone={rail.tone} title={rail.hint ?? ""}>
									{rail.label}
								</span>
								<span class="ledger-time" title={absoluteTime(post)}>{timeAgo(post)}</span>
							</div>
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
			<!-- 页脚只在筛选中出现：未筛选时总数已经在状态轨里，再写一遍是同一句话的第三份拷贝 -->
			{#if hasExtraFilter}
				<div class="list-footer">
					<div class="footer-stats">
						<span>{i18n(I18nKey.postListCount).replace("{count}", String(filteredPosts.length))}</span>
					</div>
					<button type="button" class="footer-reset" onclick={clearAllFilters}>
						{i18n(I18nKey.postClearFilter)}
					</button>
				</div>
			{/if}
			<p class="sr-only" role="status" aria-live="polite">
				{i18n(I18nKey.postResultCount).replace("{count}", String(filteredPosts.length))}
			</p>
		{/if}
	{/if}
	</div>
</div>

<!-- 冲突检查结果：显示状态；真冲突时给出两个方向的覆盖按钮，不做自动合并 -->

<!-- 同步面板：打开时先只读检查并展示差异与失败原因，用户点面板内的按钮才真正执行。
     onSynced 必须接「刷新列表」而不是 handleSync —— 后者自己就会 POST /sync，
     挂上去会导致面板同步完再拉一遍。 -->

<style>
	.md3-list-container {
		/* M3 语义角色 → 项目 token 映射。刻意不引入官方默认紫色，
		   保持品牌紫（hue 275）+ 莫奈柔彩的整体语言。 */
		--md-on-surface: var(--deep-text);
		--md-on-surface-variant: var(--content-meta);
		--md-outline: var(--line-divider);

		/* primary 直接当文字色只有 2.7:1（暗色 7.4:1 尚可，亮色不达标），
		   朝 deep-text 混 42% 后亮色 7.4:1、暗色 11.1:1，两端都稳过 AA。 */
		--md-primary-text: color-mix(in srgb, var(--primary) 42%, var(--deep-text));

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

		/* 统一控件规格：工具栏内所有控件共用高度、圆角、间距。
		   此前搜索框 48px / 按钮 44px / chip 40px 三种高度、28/22/20/8px 四种圆角
		   混排，视觉上参差不齐，这里收敛为一套 token。
		   圆角取 10px 方角而非胶囊：与参考项目（flare-stack-blog）后台
		   post-manager 的控件圆角一致，40px 高配 10px 圆角是方形按钮观感。 */
		--md-control-h: 44px;
		--md-control-r: 10px;
		--md-control-gap: 0.5rem;

		/* 账目栏宽度：三个 34px 图标 + 两个 12px 间隙 = 126px，
		   留 6px 余量。图标在悬停时接管这一栏，宽度必须容得下它们，
		   否则行会在悬停瞬间抖动。 */
		--post-rail-w: 8.25rem;

		/* 纵向 flex：页头与筛选固定，其余交给 .list-scroll 滚动。
	   高度由外层 .posts-shell 决定（与侧栏等高）。 */
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	overflow: hidden;
}

	/* 固定区：不随列表滚动 */
	.masthead,
	.filter-row {
		flex-shrink: 0;
	}

	/* ── 页头：标题、状态轨、搜索、操作同一条基线 ──
	   把原来「页头 / 筛选条 / 工具栏」三层压成一层；书签式下划线只留给当前筛选项。 */
	.masthead {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.9375rem 1.625rem;
		border-bottom: 1px solid var(--md-outline);
	}

	.masthead-title {
		margin: 0;
		font-size: 1.3125rem;
		font-weight: 650;
		line-height: 1.3;
		letter-spacing: 0.01em;
		color: var(--md-on-surface);
		flex-shrink: 0;
	}

	/* 状态轨：文字 + 等宽计数，选中项靠底部细线，未选中只是更暗的字 */
	.rail-filter {
		display: flex;
		align-items: center;
		gap: 1.125rem;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.rail-filter::-webkit-scrollbar {
		display: none;
	}

	.rail-btn {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		padding: 0 0 0.1875rem;
		border: none;
		border-bottom: 1.5px solid transparent;
		background: none;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--md-on-surface-variant);
		white-space: nowrap;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.rail-btn:hover {
		color: var(--md-on-surface);
	}

	.rail-btn:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: 2px;
	}

	.rail-btn.selected {
		color: var(--md-on-surface);
		border-bottom-color: var(--md-on-surface);
	}

	/* 「未同步」有内容时才用主色：颜色表示「需要你动手」，不是给状态发彩标 */
	.rail-btn.attention,
	.rail-btn.attention .rail-count {
		color: var(--md-primary-text);
	}

	.rail-count {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--md-on-surface-variant);
	}

	.rail-btn.selected .rail-count {
		color: inherit;
	}

	.masthead-spacer {
		flex: 1 1 auto;
		min-width: 0;
	}

	.search-bar {
		/* 后台搜索栏对照 flare post-list-search 的「内嵌搜索槽」外观：
		   底色 page-bg 25% + card-bg。基类 .ui-search 被前台导航搜索栏共用，
		   故后台外观只在此 scoped 覆盖，不污染基类。 */
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		/* 页头里它只是四个元素之一，比原来的 390px 收一档 */
		flex: 0 1 auto;
		width: min(15rem, 100%);
	}

	.search-bar:hover {
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		border-color: var(--line-color);
	}

	.search-bar:focus-within {
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		box-shadow: 0 0 0 2px var(--btn-regular-bg);
	}

	.search-bar:focus-within :global(.ui-search-icon) {
		color: var(--content-meta);
	}

	.masthead-sync,
	.masthead-create {
		flex-shrink: 0;
	}

	/* 按钮内图标统一 19px、文字左侧（图标先于文字，gap 8px） */
	:global(.btn-icon) {
		font-size: 1.1875rem;
		flex-shrink: 0;
	}

	/* ── 筛选行：常驻但不抢眼，三个紧凑控件，无分隔线 ── */
	.filter-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 1.625rem 0.375rem;
	}

	.filter-field {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	/* Select 默认 100%，在 flex 行里会撑满剩余空间 */
	.filter-field :global(.select-root) {
		width: 8.5rem;
	}

	.filter-label {
		font-size: 0.75rem;
		color: var(--md-on-surface-variant);
		white-space: nowrap;
	}

	.filter-reset {
		margin-left: auto;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm, 0.375rem);
		background: none;
		color: var(--md-primary-text);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
	}

	.filter-reset:hover {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	.filter-reset:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	/* ── 唯一滚动区 ── */
	.list-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		padding: 0.375rem 1.625rem 0.75rem;
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
		/* 空态/错误态在固定高容器内占满剩余空间并居中 */
		flex: 1;
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

	.sk-intro {
		width: 55%;
		height: 12px;
		border-radius: 4px;
	}

	/* 占位行的账目栏：两行短线，右对齐，与真实行的两行账目同高 */
	.skeleton-list .row-side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		gap: 0.375rem;
		height: auto;
	}

	.sk-line {
		width: 100%;
		height: 10px;
	}

	.sk-line.short {
		width: 64%;
	}

	.sk-line.tiny {
		width: 44%;
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

	/* ── 数据表 ── */
	/* 列表形态（对齐参考项目 post-list-table）：不叠表格边框/圆角，
	   行间分隔线承担划分；表头轻量左对齐（13px/500 灰字），随滚动吸顶。 */
	.md3-table {
		/* 滚动交给 .list-scroll；这里只是普通块，表头相对它吸顶走的是
		   最近的滚动祖先，仍然是 .list-scroll。 */
	}

	/* 列表项：一列校样。负边距让标题左缘与页头同轴，
	   悬停底色却能一直铺到卡片边缘。 */
	.list-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--post-rail-w);
		align-items: center;
		gap: 1.5rem;
		margin: 0 -1.625rem;
		padding: 0.75rem 1.625rem;
		min-height: 72px;
		border-bottom: 1px solid var(--md-outline);
		transition: background 0.15s;
	}

	.list-item:last-child {
		border-bottom: none;
	}

	.list-item:hover {
		background: var(--md-row-hover);
	}

	/* ── 账目栏 ──
	   页边的一行账：状态在上、相对时间在下，靠右成栏。
	   等宽字体负责机器数据；中文状态词会自然回落到 CJK 正文，
	   于是「左边人写的、右边仓库记的」这个区分不需要额外装饰就成立。 */
	.row-side {
		position: relative;
		align-self: center;
		height: 2.5rem;
		padding: 0;
	}

	.ledger {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		gap: 0.125rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
		transition: opacity 0.13s ease;
	}

	.ledger-state {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--md-on-surface-variant);
	}

	/* 只有「需要你动手」的状态升到主色，其余都是墨色深浅 */
	.ledger-state[data-tone="attention"] {
		color: var(--md-primary-text);
	}

/* 已发布是最安静的一档：它不需要你做任何事 */
	.ledger-time {
		font-size: 0.71875rem;
		color: var(--md-on-surface-variant);
	}

	/* 悬停/聚焦时整栏让给动作：账目淡出，三枚按钮在同一个位置浮上来，
	   行不会因为出现按钮而变宽。 */
	.list-item:hover .ledger,
	.list-item:focus-within .ledger {
		opacity: 0;
	}

	/* 行正文：标题 / 摘要 / 归档信息，三层同左缘 */
	.row-body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	/* 置顶图标：实心大头针（对齐参考项目 lucide Pin），
	   颜色沿用莫奈色板天空蓝（压深保证非文本对比 ≥3:1） */
	:global(.pin-icon) {
		font-size: 1.125rem;
		color: var(--monet-sky);
		flex-shrink: 0;
		line-height: 1;
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
		min-width: 0;
	}

	/* 标题行：标题 + 锁图标同排，锁图标紧随文字（空心、蓝色，与置顶一致） */
	.title-line {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	:global(.lock-icon) {
		font-size: 1rem;
		color: var(--monet-sky);
		flex-shrink: 0;
	}

	/* 摘要：给人读的第二行 */
	.intro {
		display: block;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--md-on-surface-variant);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	/* 归档信息：独立一层，小一号、等宽。它回答的是「这篇归在哪儿」，
	   不是行文的一部分，所以不能跟摘要排在同一行里读。 */
	.meta-line {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		/* 摘要与归档行之间再让开 2px：两行灰字靠太近就又读成一段了 */
		margin-top: 0.125rem;
		line-height: 1.3;
		min-width: 0;
	}

	.meta-cat {
		font-size: 0.6875rem;
		color: var(--md-on-surface-variant);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta-ext {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
		letter-spacing: 0.02em;
		color: var(--md-on-surface-variant);
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* 操作列 - 图标按钮
	   文字按钮退到图标后，红色「删除」不再抢占整行视线，删除与编辑之间也有独立
	   命中区（原先两个纯文本按钮相邻，容易误点）。视觉 34px + 伪元素外扩到 44dp，
	   触控目标达标又不撑高行。 */
	/* 操作按钮：查看与编辑。删除不在行内——它在编辑器头部，
	   那里才是「这篇不要了」这个决定该发生的地方。
	   视觉 34px + 伪元素外扩到 44dp，触控目标达标又不撑高行。 */
	.icon-actions {
		/* 与 .ledger 同一个格子：平时不占视觉，悬停/聚焦时接替它 */
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		/* 12px 间距 + 伪元素外扩 4px：命中区之间净留 4px 间隙。 */
		gap: 0.75rem;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.13s ease;
	}

	/* 键盘用户同样能看到动作：focus-within 由行内任一可聚焦元素触发 */
	.list-item:hover .icon-actions,
	.list-item:focus-within .icon-actions {
		opacity: 1;
		pointer-events: auto;
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

	/* 命中区外扩到 44px：34px 视觉 + 上下左右各 5px。与 12px 间距配合后
	   相邻命中区不重叠（净间隙 2px），既保住触控目标又不会让两个按钮的
	   热区串在一起 */
	:global(.icon-action::after) {
		content: "";
		position: absolute;
		inset: -5px;
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

	/* Footer：固定在卡片左下角（不随列表滚动），
	   与列表之间用一条细分隔线分层（对齐参考项目 post-list-footer）。 */
	.list-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-shrink: 0;
		padding: 0.75rem 1rem 0;
		border-top: 1px solid var(--md-outline);
		color: var(--md-on-surface-variant);
		font-size: 0.75rem;
	}

	/* 左侧统计：只在筛选时出现，因此不必再分成「总数 + 未同步」两段 */
	.footer-stats {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		min-width: 0;
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

	/* ── 自适应：按可用宽度而非设备类别切换 ── */

	/* 中等宽度：页头的搜索先让位，筛选行继续常驻 */
	@media (max-width: 1180px) {
		.search-bar {
			width: min(12rem, 100%);
		}

		.masthead {
			gap: 1.125rem;
		}
	}

	/* 窄屏：顶栏已经显示标题与主操作，页头只留状态轨与搜索 */
	@media (max-width: 1023px) {
		.masthead {
			flex-wrap: wrap;
			gap: 0.75rem 1rem;
			padding: 0.75rem 1.125rem;
		}

		.masthead-title,
		.masthead-create,
		.masthead-sync {
			display: none;
		}

		.masthead-spacer {
			display: none;
		}

		.search-bar {
			order: 2;
			flex: 1 1 100%;
			width: 100%;
		}

		.filter-row {
			padding: 0.5rem 1.125rem 0;
		}

		.list-scroll {
			padding: 0 1.125rem 0.75rem;
		}
	}

	/* 紧凑宽度：表格降级为堆叠列表项，而不是拉出 700px 横向滚动条。 */
	@media (max-width: 860px) {
		.rail-filter {
			overflow-x: auto;
			padding-bottom: 0.125rem;
		}

		/* 分类/标签/排序：一排可横滑的胶囊，不再一人一行 */
		.filter-row {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding-bottom: 0.5rem;
			scrollbar-width: none;
			-ms-overflow-style: none;
		}

		.filter-row::-webkit-scrollbar {
			display: none;
		}

		.filter-field {
			flex: 0 0 auto;
		}

		.filter-field :global(.select-root) {
			width: auto;
			flex: 0 0 auto;
		}

		/* 胶囊外观：32px 高、12px 圆角、细描边、次要面板底 */
		.filter-field :global(.select-trigger) {
			position: relative;
			width: auto;
			height: 32px;
			min-height: 32px;
			padding: 0 0.5rem;
			gap: 0.25rem;
			border: 1px solid var(--line-divider);
			border-radius: 12px;
			background: var(--btn-regular-bg);
			color: var(--deep-text);
			font-size: 0.75rem;
		}

		/* 视觉 32px 仍低于 44px 触控下限，用伪元素纵向外扩 */
		.filter-field :global(.select-trigger)::after {
			content: "";
			position: absolute;
			left: 0;
			right: 0;
			top: -6px;
			bottom: -6px;
			border-radius: 12px;
		}

		/* 窄屏：标题单独一行拿满宽度，账目栏与动作并到下方一条横排。
		   触屏没有悬停，账目和按钮必须同时可见，不能靠 hover 才显形。 */
		.list-item {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
			/* 桌面的负边距在这里必须复位：外壳留白只有 1rem，
			   -1.625rem 会把文字推出卡片左缘 */
			margin: 0;
			padding: 1rem 0;
		}

		.row-side {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 0.75rem;
			height: auto;
			min-height: 32px;
			/* 桌面网格里它是居中的单元格；这里父级变成列向 flex，
			   center 会让它按内容宽度水平居中，必须改回撑满 */
			align-self: stretch;
		}

		.ledger {
			position: static;
			flex-direction: row;
			align-items: baseline;
			gap: 0.5rem;
		}

		/* 悬停换栏只对指针设备有意义；窄屏下两者并存 */
		.list-item:hover .ledger,
		.list-item:focus-within .ledger {
			opacity: 1;
		}

		.icon-actions {
			position: static;
			opacity: 1;
			pointer-events: auto;
		}

		.title {
			white-space: normal;
			overflow-wrap: anywhere;
		}
	}

	/* ── 手机（≤768px）：把纵向空间还给列表 ── */
	@media (max-width: 768px) {
		.masthead {
			padding: 0.625rem 1rem;
		}

		.filter-row {
			padding: 0.375rem 1rem 0;
		}

		.list-scroll {
			padding: 0 1rem 0.5rem;
		}

		.title {
			font-size: 0.875rem;
			font-weight: 700;
			line-height: 1.35;
		}

		/* 操作按钮：34px → 32px、圆角 8px、间距 4px；命中区保持 44px */
		.icon-actions {
			gap: 0.25rem;
		}

		:global(.icon-action) {
			width: 32px;
			height: 32px;
			border-radius: 8px;
		}

		:global(.icon-action::after) {
			inset: -6px;
		}

		:global(.icon-action .action-icon) {
			font-size: 1rem;
		}

		.list-footer {
			padding: 0.875rem 0 0;
		}
	}
</style>

