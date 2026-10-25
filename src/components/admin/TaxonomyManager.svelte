<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { TaxonomyKind } from "@/utils/taxonomy";

/**
 * 分类 / 标签管理面板（两个路由共用，靠 kind 区分）
 *
 * 功能对齐参考项目 taxonomy-workspace：
 * - 左栏列表（搜索、计数、未分类固定项、选中态）
 * - 右栏选中项文章（范围筛选、搜索、排序、分页、草稿徽章）
 * - 新建 / 重命名 / 删除（编辑弹窗内含删除入口，Enter 提交）
 * - URL 状态同步（?name=&page=&q=&sort=），可分享可后退
 * - 焦点管理、选中项失效自动回退、名称长度限制
 *
 * 技术栈按本项目重写，不照搬参考项目的 React Query / TanStack Router。
 */
let {
	kind,
	onNotify,
}: {
	kind: TaxonomyKind;
	onNotify: (message: string, type: "success" | "error") => void;
} = $props();

const NAME_MAX = 40;
const PAGE_SIZE = 12;
const UNCATEGORIZED = "__uncategorized__";

type Entry = {
	name: string;
	kind: TaxonomyKind;
	count: number;
	draftCount: number;
	uncategorized?: boolean;
};

type PostRow = {
	slug: string;
	title: string;
	category: string;
	tags: string[];
	published: string;
	updated: string | null;
	draft: boolean;
};

type Scope = "all" | "published";
type SortKey = "updated" | "newest" | "oldest" | "title";

let entries = $state<Entry[]>([]);
let uncategorizedCount = $state(0);
let uncategorizedDraftCount = $state(0);
let loading = $state(true);
let loadError = $state("");

// 左栏
let selectedName = $state("");
let navSearch = $state("");

// 右栏
let posts = $state<PostRow[]>([]);
let postsLoading = $state(false);
let postSearch = $state("");
let sortBy = $state<SortKey>("updated");
let scope = $state<Scope>("all");
let page = $state(1);

// 弹窗
let dialogMode = $state<"" | "create" | "edit" | "delete">("");
let dialogName = $state("");
let dialogOriginal = $state("");
let dialogBusy = $state(false);
let dialogError = $state("");
let dialogInput: HTMLInputElement | null = $state(null);
let dialogInputEl: HTMLInputElement | null = null;

/** 左栏条目：分类/标签 + 分类模式下的「未分类」固定项 */
const navEntries = $derived.by(() => {
	const base = entries
		.filter((e) => e.kind === kind)
		.filter((e) =>
			navSearch.trim()
				? e.name.toLowerCase().includes(navSearch.trim().toLowerCase())
				: true,
		);
	if (kind !== "category") return base;
	return [
		...base,
		{
			name: UNCATEGORIZED,
			kind: "category" as const,
			count: uncategorizedCount,
			draftCount: uncategorizedDraftCount,
			uncategorized: true,
		},
	];
});

const selectedEntry = $derived(
	navEntries.find((e) => e.name === selectedName),
);

const isUncategorized = $derived(selectedName === UNCATEGORIZED);

/** 选中项下的文章（按 kind / 未分类过滤） */
const scopedPosts = $derived.by(() => {
	if (!selectedName) return [];
	return posts.filter((p) => {
		if (isUncategorized) return !p.category;
		return kind === "category"
			? p.category === selectedName
			: p.tags.includes(selectedName);
	});
});

/** 再按范围 + 搜索过滤 + 排序 */
const visiblePosts = $derived.by(() => {
	let list = scopedPosts;
	if (scope === "published") list = list.filter((p) => !p.draft);
	if (postSearch.trim()) {
		const q = postSearch.trim().toLowerCase();
		list = list.filter(
			(p) =>
				p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
		);
	}
	const sorted = [...list];
	switch (sortBy) {
		case "newest":
			sorted.sort(
				(a, b) =>
					new Date(b.published).getTime() - new Date(a.published).getTime(),
			);
			break;
		case "oldest":
			sorted.sort(
				(a, b) =>
					new Date(a.published).getTime() - new Date(b.published).getTime(),
			);
			break;
		case "title":
			sorted.sort((a, b) => a.title.localeCompare(b.title));
			break;
		default:
			sorted.sort((a, b) => {
				const at = new Date(a.updated ?? a.published).getTime();
				const bt = new Date(b.updated ?? b.published).getTime();
				return bt - at;
			});
	}
	return sorted;
});

const totalPages = $derived(
	Math.max(1, Math.ceil(visiblePosts.length / PAGE_SIZE)),
);
const pagedPosts = $derived(
	visiblePosts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
);

/** URL 状态同步：可分享、可后退 */
function syncUrl(replace = true) {
	const params = new URLSearchParams();
	if (selectedName && !isUncategorized) params.set("name", selectedName);
	if (isUncategorized) params.set("name", UNCATEGORIZED);
	if (page > 1) params.set("page", String(page));
	if (postSearch.trim()) params.set("q", postSearch.trim());
	if (sortBy !== "updated") params.set("sort", sortBy);
	if (scope !== "all") params.set("scope", scope);
	const qs = params.toString();
	const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
	const cur = `${window.location.pathname}${window.location.search}`;
	if (next === cur) return;
	if (replace) window.history.replaceState({}, "", next);
	else window.history.pushState({}, "", next);
}

/** 从 URL 恢复状态 */
function readUrl() {
	const params = new URLSearchParams(window.location.search);
	const name = params.get("name");
	if (name) selectedName = name;
	const p = Number(params.get("page"));
	if (Number.isInteger(p) && p > 0) page = p;
	const q = params.get("q");
	if (q) postSearch = q;
	const s = params.get("sort");
	if (s === "newest" || s === "oldest" || s === "title" || s === "updated") {
		sortBy = s;
	}
	const sc = params.get("scope");
	if (sc === "published" || sc === "all") scope = sc;
}

async function load() {
	loading = true;
	loadError = "";
	try {
		const res = await fetch("/api/admin/taxonomy/");
		const data = await res.json();
		if (!data.success) throw new Error(data.message || "load failed");
		entries = data.entries ?? [];
		uncategorizedCount = data.uncategorizedCount ?? 0;
		uncategorizedDraftCount = data.uncategorizedDraftCount ?? 0;

		// 选中项失效自动回退：URL 指定的名字不存在时，落到第一项
		const list = navEntries;
		if (!selectedName || !list.some((e) => e.name === selectedName)) {
			selectedName = list[0]?.name ?? "";
			page = 1;
		}
	} catch {
		loadError = i18n(I18nKey.taxonomyLoadFailed);
	} finally {
		loading = false;
	}
}

async function loadPosts() {
	postsLoading = true;
	try {
		const res = await fetch("/api/admin/posts/");
		const data = await res.json();
		if (!data.success) throw new Error("load failed");
		posts = data.posts ?? [];
	} catch {
		posts = [];
	} finally {
		postsLoading = false;
	}
}

function selectEntry(name: string) {
	selectedName = name;
	page = 1;
	postSearch = "";
	syncUrl(false);
}

function changeScope(next: Scope) {
	scope = next;
	page = 1;
	syncUrl();
}

function changeSort(next: SortKey) {
	sortBy = next;
	page = 1;
	syncUrl();
}

function changePage(next: number) {
	if (next < 1 || next > totalPages) return;
	page = next;
	syncUrl();
}

function openCreate() {
	dialogMode = "create";
	dialogName = "";
	dialogOriginal = "";
	dialogError = "";
	void focusDialogInput();
}

function openEdit(name: string) {
	if (name === UNCATEGORIZED) return;
	dialogMode = "edit";
	dialogName = name;
	dialogOriginal = name;
	dialogError = "";
	void focusDialogInput();
}

function openDelete(name: string) {
	if (name === UNCATEGORIZED) return;
	dialogMode = "delete";
	dialogName = name;
	dialogOriginal = name;
	dialogError = "";
}

/** 弹窗打开后聚焦输入框（对齐参考项目 initialFocus） */
async function focusDialogInput() {
	await Promise.resolve();
	dialogInputEl?.focus();
	dialogInputEl?.select();
}

function closeDialog() {
	if (dialogBusy) return;
	dialogMode = "";
	dialogError = "";
}

async function submitDialog() {
	dialogError = "";
	const name = dialogName.trim();

	if (dialogMode !== "delete") {
		if (!name) {
			dialogError = i18n(I18nKey.taxonomyNameRequired);
			return;
		}
		if (name.length > NAME_MAX) {
			dialogError = i18n(I18nKey.taxonomyNameTooLong).replace(
				"{max}",
				String(NAME_MAX),
			);
			return;
		}
		// 前端预检重名，省一次往返（后端仍会校验）
		const dup = entries.some(
			(e) =>
				e.kind === kind &&
				e.name === name &&
				!(dialogMode === "edit" && e.name === dialogOriginal),
		);
		if (dup) {
			dialogError = i18n(I18nKey.taxonomyNameExists);
			return;
		}
	}

	dialogBusy = true;
	try {
		const payload =
			dialogMode === "create"
				? { action: "create", kind, name }
				: dialogMode === "edit"
					? { action: "rename", kind, name: dialogOriginal, newName: name }
					: { action: "delete", kind, name: dialogOriginal };

		const res = await fetch("/api/admin/taxonomy/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		const data = await res.json();
		if (!data.success) {
			dialogError = data.message || "failed";
			return;
		}
		onNotify(
			dialogMode === "create"
				? i18n(I18nKey.taxonomyCreated)
				: dialogMode === "edit"
					? i18n(I18nKey.taxonomyRenamed)
					: i18n(I18nKey.taxonomyDeleted),
			"success",
		);
		if (dialogMode === "edit") selectedName = name;
		if (dialogMode === "delete") selectedName = "";
		dialogMode = "";
		await load();
		await loadPosts();
		syncUrl();
	} catch {
		dialogError = i18n(I18nKey.taxonomyLoadFailed);
	} finally {
		dialogBusy = false;
	}
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
}

$effect(() => {
	void load();
	void loadPosts();
	readUrl();
});
</script>

<div class="taxonomy-browser">
	<!-- 左栏 -->
	<aside class="taxonomy-explorer">
		<div class="explorer-head">
			<div class="taxonomy-search nav-search">
				<Icon icon="material-symbols:search" class="search-icon" />
				<input
					type="search"
					bind:value={navSearch}
					placeholder={i18n(I18nKey.taxonomySearch)}
					aria-label={i18n(I18nKey.taxonomySearch)}
				/>
			</div>
			<button
				class="ui-btn ui-btn-primary create-btn"
				type="button"
				onclick={openCreate}
				title={i18n(I18nKey.taxonomyNew)}
				aria-label={i18n(I18nKey.taxonomyNew)}
			>
				<Icon icon="material-symbols:add" class="btn-icon" />
			</button>
		</div>

		<div class="nav-scroll">
			{#if loading}
				<div class="nav-state">
					<Icon icon="material-symbols:progress-activity" class="spin" />
				</div>
			{:else if loadError}
				<div class="nav-state error">
					<span>{loadError}</span>
					<button class="ui-btn ui-btn-soft" type="button" onclick={load}>
						{i18n(I18nKey.secretsReload)}
					</button>
				</div>
			{:else if navEntries.length === 0}
				<p class="nav-empty">
					{navSearch.trim()
						? i18n(I18nKey.taxonomyNoMatch)
						: i18n(I18nKey.taxonomyEmpty)}
				</p>
			{:else}
				{#each navEntries as entry (entry.name)}
					<button
						class="nav-item"
						class:active={selectedName === entry.name}
						class:uncategorized={entry.uncategorized}
						type="button"
						aria-pressed={selectedName === entry.name}
						onclick={() => selectEntry(entry.name)}
					>
						<span class="nav-name">
							{entry.uncategorized ? i18n(I18nKey.taxonomyUncategorized) : entry.name}
						</span>
						<span class="nav-count">
							{entry.count}
							{#if entry.draftCount > 0}
								<small>+{entry.draftCount}</small>
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</aside>

	<!-- 右栏 -->
	<section class="taxonomy-results">
		<header class="results-head">
			<div class="results-title">
				<h2>
					{isUncategorized
						? i18n(I18nKey.taxonomyUncategorized)
						: selectedName ||
							i18n(
								kind === "category" ? I18nKey.adminCategories : I18nKey.adminTags,
							)}
				</h2>
				{#if selectedEntry}
					<span class="results-count">
						{i18n(I18nKey.taxonomyPostCount).replace(
							"{count}",
							String(selectedEntry.count),
						)}
					</span>
				{/if}
			</div>
			{#if selectedName && !isUncategorized}
				<div class="results-actions">
					<button
						class="icon-btn"
						type="button"
						title={i18n(I18nKey.taxonomyRename)}
						aria-label={i18n(I18nKey.taxonomyRename)}
						onclick={() => openEdit(selectedName)}
					>
						<Icon icon="material-symbols:edit-outline" />
					</button>
					<button
						class="icon-btn danger"
						type="button"
						title={i18n(I18nKey.taxonomyDelete)}
						aria-label={i18n(I18nKey.taxonomyDelete)}
						onclick={() => openDelete(selectedName)}
					>
						<Icon icon="material-symbols:delete-outline" />
					</button>
				</div>
			{/if}
		</header>

		{#if selectedName}
			<div class="scope-tabs" role="group" aria-label={i18n(I18nKey.taxonomyScopeAll)}>
				<button
					type="button"
					aria-pressed={scope === "all"}
					onclick={() => changeScope("all")}
				>
					{i18n(I18nKey.taxonomyScopeAll)} <span>{scopedPosts.length}</span>
				</button>
				<button
					type="button"
					aria-pressed={scope === "published"}
					onclick={() => changeScope("published")}
				>
					{i18n(I18nKey.taxonomyScopePublished)}{" "}
					<span>{scopedPosts.filter((p) => !p.draft).length}</span>
				</button>
			</div>

			<div class="post-controls">
				<div class="taxonomy-search post-search">
					<Icon icon="material-symbols:search" class="search-icon" />
					<input
						type="search"
						bind:value={postSearch}
						oninput={() => {
							page = 1;
							syncUrl();
						}}
						placeholder={i18n(I18nKey.taxonomySearch)}
						aria-label={i18n(I18nKey.taxonomySearch)}
					/>
				</div>
				<label class="sort-wrap">
					<span class="sort-label">{i18n(I18nKey.taxonomySortLabel)}</span>
					<select
						class="sort-select"
						value={sortBy}
						onchange={(e) => changeSort(e.currentTarget.value as SortKey)}
					>
						<option value="updated">{i18n(I18nKey.postSortUpdated)}</option>
						<option value="newest">{i18n(I18nKey.postSortNewest)}</option>
						<option value="oldest">{i18n(I18nKey.postSortOldest)}</option>
						<option value="title">{i18n(I18nKey.postSortTitleAsc)}</option>
					</select>
				</label>
			</div>

			<div class="post-scroll">
				{#if postsLoading}
					<div class="post-state">
						<Icon icon="material-symbols:progress-activity" class="spin" />
					</div>
				{:else if visiblePosts.length === 0}
					<div class="post-state">
						<Icon icon="material-symbols:inbox-outline" />
						<span>
							{postSearch.trim()
								? i18n(I18nKey.taxonomyNoMatch)
								: i18n(I18nKey.taxonomyNoPosts)}
						</span>
					</div>
				{:else}
					<table class="post-table">
						<thead>
							<tr>
								<th>{i18n(I18nKey.taxonomyPostTitle)}</th>
								<th class="col-status">{i18n(I18nKey.taxonomyPostStatus)}</th>
								<th class="col-date">{i18n(I18nKey.taxonomyPostDate)}</th>
							</tr>
						</thead>
						<tbody>
							{#each pagedPosts as post (post.slug)}
								<tr>
									<td class="col-title">
										<span class="post-title" title={post.title}>{post.title}</span>
									</td>
									<td class="col-status">
										<span class="status-pill" class:draft={post.draft}>
											{post.draft
												? i18n(I18nKey.taxonomyDraftBadge)
												: i18n(I18nKey.postPublished)}
										</span>
									</td>
									<td class="col-date">{formatDate(post.updated ?? post.published)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>

			{#if visiblePosts.length > 0}
				<footer class="post-footer">
					<span>
						{i18n(I18nKey.taxonomyPostCount).replace(
							"{count}",
							String(visiblePosts.length),
						)}
					</span>
					{#if totalPages > 1}
						<div class="pager">
							<button
								class="icon-btn"
								type="button"
								disabled={page <= 1}
								aria-label={i18n(I18nKey.paginationPrev)}
								onclick={() => changePage(page - 1)}
							>
								<Icon icon="material-symbols:chevron-left" />
							</button>
							<span>{page} / {totalPages}</span>
							<button
								class="icon-btn"
								type="button"
								disabled={page >= totalPages}
								aria-label={i18n(I18nKey.paginationNext)}
								onclick={() => changePage(page + 1)}
							>
								<Icon icon="material-symbols:chevron-right" />
							</button>
						</div>
					{/if}
				</footer>
			{/if}
		{:else}
			<div class="post-state">
				<Icon icon="material-symbols:inbox-outline" />
				<span>{i18n(I18nKey.taxonomyEmptyHint)}</span>
			</div>
		{/if}
	</section>
</div>

{#if dialogMode}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) closeDialog();
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") closeDialog();
		}}
	>
		<div class="modal-card card-base">
			<div class="modal-head">
				<h3>
					{dialogMode === "create"
						? i18n(I18nKey.taxonomyCreateTitle)
						: dialogMode === "edit"
							? i18n(I18nKey.taxonomyRenameTitle)
							: i18n(I18nKey.taxonomyDeleteTitle)}
				</h3>
				<button
					class="modal-close"
					type="button"
					aria-label={i18n(I18nKey.taxonomyCancel)}
					onclick={closeDialog}
				>
					<Icon icon="material-symbols:close" />
				</button>
			</div>

			{#if dialogMode === "delete"}
				<p class="modal-desc">
					{i18n(I18nKey.taxonomyDeleteConfirm)
						.replace("{name}", dialogOriginal)
						.replace(
							"{count}",
							String(
								entries.find(
									(e) => e.kind === kind && e.name === dialogOriginal,
								)?.count ?? 0,
							),
						)}
				</p>
				{#if kind === "category"}
					<p class="modal-hint">
						{i18n(I18nKey.taxonomyDeleteToUncategorized)}
					</p>
				{/if}
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void submitDialog();
					}}
				>
					<label class="modal-field">
						<span>{i18n(I18nKey.taxonomyNameLabel)}</span>
						<input
							bind:this={dialogInputEl}
							type="text"
							bind:value={dialogName}
							maxlength={NAME_MAX}
							placeholder={i18n(I18nKey.taxonomyNamePlaceholder)}
							disabled={dialogBusy}
						/>
					</label>
					{#if dialogError}
						<p class="modal-error">{dialogError}</p>
					{/if}
					<div class="modal-actions">
						{#if dialogMode === "edit"}
							<button
								class="modal-delete"
								type="button"
								disabled={dialogBusy}
								onclick={() => openDelete(dialogOriginal)}
							>
								{i18n(I18nKey.taxonomyDelete)}
							</button>
						{/if}
						<button
							class="ui-btn ui-btn-primary"
							type="submit"
							disabled={dialogBusy}
						>
							{dialogBusy
								? i18n(I18nKey.taxonomySaving)
								: i18n(I18nKey.taxonomyConfirm)}
						</button>
						<button
							class="ui-btn ui-btn-soft"
							type="button"
							onclick={closeDialog}
							disabled={dialogBusy}
						>
							{i18n(I18nKey.taxonomyCancel)}
						</button>
					</div>
				</form>
			{/if}

			{#if dialogMode === "delete"}
				{#if dialogError}
					<p class="modal-error">{dialogError}</p>
				{/if}
				<div class="modal-actions">
					<button
						class="ui-btn ui-btn-primary danger"
						type="button"
						onclick={submitDialog}
						disabled={dialogBusy}
					>
						{dialogBusy
							? i18n(I18nKey.taxonomySaving)
							: i18n(I18nKey.taxonomyDelete)}
					</button>
					<button
						class="ui-btn ui-btn-soft"
						type="button"
						onclick={closeDialog}
						disabled={dialogBusy}
					>
						{i18n(I18nKey.taxonomyCancel)}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.taxonomy-browser {
		display: flex;
		gap: 1.25rem;
		flex: 1;
		min-height: 0;
	}

	/* ── 左栏 ── */
	.taxonomy-explorer {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		width: 260px;
		flex-shrink: 0;
		min-height: 0;
		padding-right: 1.25rem;
		border-right: 1px solid var(--line-divider);
	}

	.explorer-head {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.nav-search {
		flex: 1;
		min-width: 0;
	}

	.create-btn {
		width: 2.625rem;
		min-width: 2.625rem;
		padding: 0;
		flex-shrink: 0;
	}

	.nav-scroll {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		overflow-y: auto;
		min-height: 0;
	}

	.nav-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.nav-state.error {
		color: var(--destructive);
	}

	.nav-empty {
		margin: 0;
		padding: 2rem 0.5rem;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.nav-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--content-meta);
		font-size: 0.8125rem;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.nav-item:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.nav-item.active {
		background: color-mix(in oklab, var(--primary) 15%, transparent);
		color: var(--primary);
		font-weight: 500;
	}

	/* 未分类项：与普通项用分隔线区隔，提示它不是真实分类 */
	.nav-item.uncategorized {
		margin-top: 0.375rem;
		border-top: 1px solid var(--line-divider);
		border-radius: 0 0 6px 6px;
		padding-top: 0.625rem;
		font-style: italic;
	}

	.nav-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		opacity: 0.75;
	}

	.nav-count small {
		margin-left: 0.25rem;
		font-size: 0.6875rem;
		opacity: 0.7;
	}

	/* ── 右栏 ── */
	.taxonomy-results {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.results-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-shrink: 0;
	}

	.results-title {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		min-width: 0;
	}

	.results-title h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.results-count {
		flex-shrink: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.results-actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	/* 范围切换（对齐参考项目 .taxonomy-scope-tabs） */
	.scope-tabs {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.scope-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.3125rem 0.625rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--content-meta);
		font-size: 0.75rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}

	.scope-tabs button:hover {
		color: var(--deep-text);
	}

	.scope-tabs button[aria-pressed="true"] {
		background: color-mix(in oklab, var(--primary) 12%, transparent);
		border-color: color-mix(in oklab, var(--primary) 30%, transparent);
		color: var(--primary);
	}

	.scope-tabs span {
		font-size: 0.6875rem;
		opacity: 0.8;
	}

	.post-controls {
		display: flex;
		gap: 0.625rem;
		flex-shrink: 0;
	}

	.post-search {
		flex: 1;
		min-width: 0;
	}

	.sort-wrap {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.sort-label {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.sort-select {
		min-height: 2.375rem;
		padding: 0 0.625rem;
		border: 1px solid var(--input-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--deep-text);
		font-size: 0.8125rem;
		font-family: inherit;
		cursor: pointer;
	}

	.post-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.post-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		color: var(--content-meta);
		font-size: 0.875rem;
		text-align: center;
	}

	.post-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.post-table th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--line-divider);
		background: var(--card-bg);
		color: var(--content-meta);
		font-size: 0.75rem;
		font-weight: 500;
		text-align: left;
		white-space: nowrap;
	}

	.post-table td {
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid color-mix(in oklab, var(--line-divider) 60%, transparent);
		color: var(--deep-text);
	}

	.post-table tr:hover td {
		background: color-mix(in oklab, var(--deep-text) 4%, transparent);
	}

	.col-title {
		width: 100%;
		max-width: 0;
	}

	.post-title {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-status,
	.col-date {
		white-space: nowrap;
		color: var(--content-meta);
	}

	.status-pill {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in oklab, var(--success) 15%, transparent);
		color: color-mix(in oklab, var(--success) 65%, var(--deep-text));
		font-size: 0.75rem;
	}

	.status-pill.draft {
		background: color-mix(in oklab, var(--warning) 15%, transparent);
		color: color-mix(in oklab, var(--warning) 65%, var(--deep-text));
	}

	.post-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line-divider);
		font-size: 0.75rem;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* ── 通用 ── */
	.taxonomy-search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.375rem;
		padding: 0 0.625rem;
		border: 1px solid var(--input-border);
		border-radius: 8px;
		background: var(--input-bg);
		transition: border-color 0.15s ease;
	}

	.taxonomy-search:focus-within {
		border-color: color-mix(in oklab, var(--primary) 45%, transparent);
	}

	.taxonomy-search .search-icon {
		flex-shrink: 0;
		color: var(--content-meta);
	}

	.taxonomy-search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		color: var(--deep-text);
		font-size: 0.8125rem;
		font-family: inherit;
		outline: none;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.icon-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.icon-btn.danger:hover:not(:disabled) {
		background: color-mix(in oklab, var(--destructive) 12%, transparent);
		color: var(--destructive);
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── 弹窗 ── */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.25);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
	}

	.modal-card {
		width: 100%;
		max-width: 420px;
		padding: 1.5rem;
		background: var(--float-panel-bg);
		box-shadow: var(--shadow-card);
		border-radius: var(--radius-large);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.modal-head h3 {
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.modal-close:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.modal-desc {
		margin: 0 0 1.25rem;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--content-meta);
	}

	.modal-hint {
		margin: -0.75rem 0 1.25rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		opacity: 0.8;
	}

	.modal-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		font-size: 0.8125rem;
		color: var(--deep-text);
	}

	.modal-field input {
		width: 100%;
		min-height: 2.625rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--input-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-family: inherit;
	}

	.modal-field input:focus {
		outline: 2px solid var(--primary);
		outline-offset: 1px;
	}

	.modal-error {
		margin: 0 0 0.75rem;
		font-size: 0.8125rem;
		color: var(--destructive);
	}

	.modal-actions {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		justify-content: flex-end;
	}

	/* 编辑弹窗内的删除入口：靠左，与主操作分离 */
	.modal-delete {
		margin-right: auto;
		padding: 0.5rem 0;
		border: none;
		background: transparent;
		color: var(--destructive);
		font-size: 0.8125rem;
		font-family: inherit;
		cursor: pointer;
		opacity: 0.85;
		transition: opacity 0.15s ease;
	}

	.modal-delete:hover:not(:disabled) {
		opacity: 1;
		text-decoration: underline;
	}

	.modal-delete:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.ui-btn.danger {
		background: var(--destructive);
		color: #fff;
	}

	@media (max-width: 900px) {
		.taxonomy-browser {
			flex-direction: column;
		}

		.taxonomy-explorer {
			width: 100%;
			max-height: 200px;
			padding-right: 0;
			padding-bottom: 0.75rem;
			border-right: none;
			border-bottom: 1px solid var(--line-divider);
		}
	}
</style>
