<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { TaxonomyKind } from "@/utils/taxonomy";

/**
 * 分类 / 标签管理面板（两个路由共用，靠 kind 区分）
 *
 * 形态对齐参考项目 taxonomy-workspace：左侧列表 + 右侧选中项的文章列表。
 * 技术栈按本项目重写（手写状态、fetch、本项目 i18n），不照搬其
 * React Query / TanStack Router / Paraglide 结构。
 */
let {
	kind,
	onNotify,
}: {
	kind: TaxonomyKind;
	onNotify: (message: string, type: "success" | "error") => void;
} = $props();

type Entry = {
	name: string;
	kind: TaxonomyKind;
	count: number;
	draftCount: number;
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

let entries = $state<Entry[]>([]);
let uncategorizedCount = $state(0);
let loading = $state(true);
let loadError = $state("");

// 左栏：选中项与搜索
let selectedName = $state("");
let navSearch = $state("");

// 右栏：文章列表与筛选
let posts = $state<PostRow[]>([]);
let postsLoading = $state(false);
let postSearch = $state("");
let sortBy = $state<"updated" | "newest" | "oldest" | "title">("updated");
let page = $state(1);
const PAGE_SIZE = 10;

// 弹窗
let dialogMode = $state<"" | "create" | "rename" | "delete">("");
let dialogName = $state("");
let dialogOriginal = $state("");
let dialogBusy = $state(false);
let dialogError = $state("");

const visibleEntries = $derived(
	entries
		.filter((e) => e.kind === kind)
		.filter((e) =>
			navSearch.trim()
				? e.name.toLowerCase().includes(navSearch.trim().toLowerCase())
				: true,
		),
);

const selectedEntry = $derived(
	entries.find((e) => e.kind === kind && e.name === selectedName),
);

/** 右栏：按选中项过滤 + 搜索 + 排序 */
const filteredPosts = $derived.by(() => {
	let list = posts;
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

const totalPages = $derived(Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE)));
const pagedPosts = $derived(
	filteredPosts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
);

async function load() {
	loading = true;
	loadError = "";
	try {
		const res = await fetch("/api/admin/taxonomy/");
		const data = await res.json();
		if (!data.success) throw new Error(data.message || "load failed");
		entries = data.entries ?? [];
		uncategorizedCount = data.uncategorizedCount ?? 0;
		// 默认选中第一项
		const first = (data.entries ?? []).find(
			(e: Entry) => e.kind === kind,
		);
		if (first && !selectedName) selectedName = first.name;
		if (first && !(data.entries ?? []).some((e: Entry) => e.kind === kind && e.name === selectedName)) {
			selectedName = first.name;
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

/** 选中项下的文章（按 kind 过滤） */
const selectedPosts = $derived.by(() => {
	if (!selectedName) return [];
	return filteredPosts.filter((p) =>
		kind === "category" ? p.category === selectedName : p.tags.includes(selectedName),
	);
});

const selectedPaged = $derived(
	selectedPosts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
);

const selectedTotalPages = $derived(
	Math.max(1, Math.ceil(selectedPosts.length / PAGE_SIZE)),
);

function selectEntry(name: string) {
	selectedName = name;
	page = 1;
	postSearch = "";
}

function openCreate() {
	dialogMode = "create";
	dialogName = "";
	dialogOriginal = "";
	dialogError = "";
}

function openRename(name: string) {
	dialogMode = "rename";
	dialogName = name;
	dialogOriginal = name;
	dialogError = "";
}

function openDelete(name: string) {
	dialogMode = "delete";
	dialogName = name;
	dialogOriginal = name;
	dialogError = "";
}

function closeDialog() {
	if (dialogBusy) return;
	dialogMode = "";
	dialogError = "";
}

async function submitDialog() {
	dialogError = "";
	const name = dialogName.trim();
	if (dialogMode !== "delete" && !name) {
		dialogError = i18n(I18nKey.taxonomyNameRequired);
		return;
	}

	dialogBusy = true;
	try {
		const payload =
			dialogMode === "create"
				? { action: "create", kind, name }
				: dialogMode === "rename"
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
				: dialogMode === "rename"
					? i18n(I18nKey.taxonomyRenamed)
					: i18n(I18nKey.taxonomyDeleted),
			"success",
		);
		// 重命名后选中项跟随新名；删除后清空选中
		if (dialogMode === "rename") selectedName = name;
		if (dialogMode === "delete") selectedName = "";
		dialogMode = "";
		await load();
		await loadPosts();
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
});
</script>

<div class="taxonomy-browser">
	<!-- 左栏：分类/标签列表 -->
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
			{:else if visibleEntries.length === 0}
				<p class="nav-empty">
					{navSearch.trim()
						? i18n(I18nKey.taxonomyNoMatch)
						: i18n(I18nKey.taxonomyEmpty)}
				</p>
			{:else}
				{#each visibleEntries as entry (entry.name)}
					<button
						class="nav-item"
						class:active={selectedName === entry.name}
						type="button"
						aria-pressed={selectedName === entry.name}
						onclick={() => selectEntry(entry.name)}
					>
						<span class="nav-name">{entry.name}</span>
						<span class="nav-count">{entry.count}</span>
					</button>
				{/each}
			{/if}
		</div>
	</aside>

	<!-- 右栏：选中项的文章 -->
	<section class="taxonomy-results">
		<header class="results-head">
			<div class="results-title">
				<h2>
					{selectedName || i18n(kind === "category" ? I18nKey.adminCategories : I18nKey.adminTags)}
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
			{#if selectedName}
				<div class="results-actions">
					<button
						class="icon-btn"
						type="button"
						title={i18n(I18nKey.taxonomyRename)}
						aria-label={i18n(I18nKey.taxonomyRename)}
						onclick={() => openRename(selectedName)}
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
			<div class="post-controls">
				<div class="taxonomy-search post-search">
					<Icon icon="material-symbols:search" class="search-icon" />
					<input
						type="search"
						bind:value={postSearch}
						placeholder={i18n(I18nKey.taxonomySearch)}
						aria-label={i18n(I18nKey.taxonomySearch)}
					/>
				</div>
				<select class="sort-select" bind:value={sortBy} aria-label={i18n(I18nKey.postSortUpdated)}>
					<option value="updated">{i18n(I18nKey.postSortUpdated)}</option>
					<option value="newest">{i18n(I18nKey.postSortNewest)}</option>
					<option value="oldest">{i18n(I18nKey.postSortOldest)}</option>
					<option value="title">{i18n(I18nKey.postSortTitleAsc)}</option>
				</select>
			</div>

			<div class="post-scroll">
				{#if postsLoading}
					<div class="post-state">
						<Icon icon="material-symbols:progress-activity" class="spin" />
					</div>
				{:else if selectedPosts.length === 0}
					<div class="post-state">
						<Icon icon="material-symbols:inbox-outline" />
						<span>
							{postSearch.trim()
								? i18n(I18nKey.taxonomyNoMatch)
								: i18n(I18nKey.taxonomyEmpty)}
						</span>
					</div>
				{:else}
					<table class="post-table">
						<thead>
							<tr>
								<th>{i18n(I18nKey.adminPosts)}</th>
								<th class="col-status">{i18n(I18nKey.postPublished)}</th>
								<th class="col-date">{i18n(I18nKey.postSortUpdated)}</th>
							</tr>
						</thead>
						<tbody>
							{#each selectedPaged as post (post.slug)}
								<tr>
									<td class="col-title">
										<span class="post-title" title={post.title}>{post.title}</span>
									</td>
									<td class="col-status">
										<span class="status-pill" class:draft={post.draft}>
											{post.draft
												? i18n(I18nKey.postDraft)
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

			{#if selectedPosts.length > 0}
				<footer class="post-footer">
					<span>
						{i18n(I18nKey.taxonomyPostCount).replace(
							"{count}",
							String(selectedPosts.length),
						)}
					</span>
					{#if selectedTotalPages > 1}
						<div class="pager">
							<button
								class="icon-btn"
								type="button"
								disabled={page <= 1}
								aria-label={i18n(I18nKey.paginationPrev)}
								onclick={() => (page -= 1)}
							>
								<Icon icon="material-symbols:chevron-left" />
							</button>
							<span>{page} / {selectedTotalPages}</span>
							<button
								class="icon-btn"
								type="button"
								disabled={page >= selectedTotalPages}
								aria-label={i18n(I18nKey.paginationNext)}
								onclick={() => (page += 1)}
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
					<Icon
						icon={dialogMode === "delete"
							? "material-symbols:warning-rounded"
							: "material-symbols:edit-outline"}
						class="modal-head-icon"
					/>
					<span>
						{dialogMode === "create"
							? i18n(I18nKey.taxonomyCreateTitle)
							: dialogMode === "rename"
								? i18n(I18nKey.taxonomyRenameTitle)
								: i18n(I18nKey.taxonomyDeleteTitle)}
					</span>
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
								entries.find((e) => e.name === dialogOriginal)?.count ?? 0,
							),
						)}
				</p>
			{:else}
				<label class="modal-field">
					<span>{i18n(I18nKey.taxonomyNameLabel)}</span>
					<input
						type="text"
						bind:value={dialogName}
						placeholder={i18n(I18nKey.taxonomyNamePlaceholder)}
						disabled={dialogBusy}
					/>
				</label>
			{/if}

			{#if dialogError}
				<p class="modal-error">{dialogError}</p>
			{/if}

			<div class="modal-actions">
				<button
					class={dialogMode === "delete"
						? "ui-btn ui-btn-soft"
						: "ui-btn ui-btn-primary"}
					type="button"
					onclick={submitDialog}
					disabled={dialogBusy}
				>
					{dialogBusy ? i18n(I18nKey.taxonomySaving) : i18n(I18nKey.taxonomyConfirm)}
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
		</div>
	</div>
{/if}

<style>
	/* ── 左右分栏（对齐参考项目 .taxonomy-browser）── */
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

	.post-controls {
		display: flex;
		gap: 0.625rem;
		flex-shrink: 0;
	}

	.post-search {
		flex: 1;
		min-width: 0;
	}

	.sort-select {
		flex-shrink: 0;
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	:global(.modal-head-icon) {
		color: var(--primary);
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

	/* 窄屏：左栏折叠为顶部横条 */
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
