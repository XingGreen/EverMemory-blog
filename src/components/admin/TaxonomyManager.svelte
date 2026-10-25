<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { TaxonomyKind } from "@/utils/taxonomy";

/**
 * 分类 / 标签管理面板（两个路由共用，靠 kind 区分）
 *
 * 布局与交互严格对照参考项目 taxonomy-workspace / taxonomy-explorer /
 * taxonomy-posts 的 CSS 数值，技术栈按本项目重写。
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
	pinned?: boolean;
};

type Scope = "all" | "published";
type SortKey = "updated" | "newest" | "oldest" | "title";

let entries = $state<Entry[]>([]);
let uncategorizedCount = $state(0);
let uncategorizedDraftCount = $state(0);
let loading = $state(true);
let loadError = $state("");

let selectedName = $state("");
let navSearch = $state("");

let posts = $state<PostRow[]>([]);
let postsLoading = $state(false);
let postSearch = $state("");
let sortBy = $state<SortKey>("updated");
let scope = $state<Scope>("all");
let page = $state(1);

let dialogMode = $state<"" | "create" | "edit" | "delete">("");
let dialogName = $state("");
let dialogOriginal = $state("");
let dialogBusy = $state(false);
let dialogError = $state("");
let dialogInputEl: HTMLInputElement | null = null;

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

const scopedPosts = $derived.by(() => {
	if (!selectedName) return [];
	return posts.filter((p) => {
		if (isUncategorized) return !p.category;
		return kind === "category"
			? p.category === selectedName
			: p.tags.includes(selectedName);
	});
});

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

const publishedCount = $derived(scopedPosts.filter((p) => !p.draft).length);

function syncUrl(replace = true) {
	const params = new URLSearchParams();
	if (selectedName) params.set("name", selectedName);
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

function clearPostSearch() {
	postSearch = "";
	page = 1;
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
	<aside class="taxonomy-explorer">
		<div class="taxonomy-nav-search taxonomy-search">
			<Icon icon="material-symbols:search" class="search-icon" />
			<input
				type="search"
				bind:value={navSearch}
				placeholder={i18n(I18nKey.taxonomySearch)}
				aria-label={i18n(I18nKey.taxonomySearch)}
			/>
		</div>

		<div class="taxonomy-nav-scroll">
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
				<p class="taxonomy-nav-empty">
					{navSearch.trim()
						? i18n(I18nKey.taxonomyNoMatch)
						: i18n(I18nKey.taxonomyEmpty)}
				</p>
			{:else}
				{#each navEntries as entry (entry.name)}
					{#if entry.uncategorized}
						<div class="taxonomy-uncategorized">
							<button
								class="taxonomy-nav-item"
								type="button"
								aria-pressed={selectedName === entry.name}
								onclick={() => selectEntry(entry.name)}
							>
								<span class="taxonomy-nav-name"
									>{i18n(I18nKey.taxonomyUncategorized)}</span
								>
								<span class="taxonomy-nav-count">
									{entry.count}
									{#if entry.draftCount > 0}
										<small>+{entry.draftCount}</small>
									{/if}
								</span>
							</button>
						</div>
					{:else}
						<button
							class="taxonomy-nav-item"
							type="button"
							aria-pressed={selectedName === entry.name}
							onclick={() => selectEntry(entry.name)}
						>
							<span class="taxonomy-nav-name">{entry.name}</span>
							<span class="taxonomy-nav-count">
								{entry.count}
								{#if entry.draftCount > 0}
									<small>+{entry.draftCount}</small>
								{/if}
							</span>
						</button>
					{/if}
				{/each}
			{/if}
		</div>
	</aside>

	<section class="taxonomy-results">
		<header class="taxonomy-selection-heading">
			<h2>
				{isUncategorized
					? i18n(I18nKey.taxonomyUncategorized)
					: selectedName ||
						i18n(
							kind === "category" ? I18nKey.adminCategories : I18nKey.adminTags,
						)}
			</h2>
			{#if selectedName && !isUncategorized}
				<button
					class="taxonomy-context-action"
					type="button"
					title={i18n(I18nKey.taxonomyRename)}
					aria-label={i18n(I18nKey.taxonomyRename)}
					aria-haspopup="dialog"
					onclick={() => openEdit(selectedName)}
				>
					<Icon icon="material-symbols:more-horiz" />
				</button>
			{/if}
		</header>

		{#if selectedName}
			<div class="taxonomy-scope-tabs" role="group">
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
					{i18n(I18nKey.taxonomyScopePublished)} <span>{publishedCount}</span>
				</button>
			</div>

			<p class="taxonomy-scope-hint">
				{scope === "all"
					? i18n(I18nKey.taxonomyScopeAllHint)
					: i18n(I18nKey.taxonomyScopePublishedHint)}
			</p>

			<div class="taxonomy-post-controls">
				<div class="taxonomy-search">
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
					{#if postSearch}
						<button
							type="button"
							aria-label={i18n(I18nKey.taxonomyCancel)}
							onclick={clearPostSearch}
						>
							<Icon icon="material-symbols:close" />
						</button>
					{/if}
				</div>
				<div class="taxonomy-sort">
					<span>{i18n(I18nKey.taxonomySortLabel)}</span>
					<select
						class="taxonomy-sort-trigger"
						value={sortBy}
						onchange={(e) => changeSort(e.currentTarget.value as SortKey)}
					>
						<option value="updated">{i18n(I18nKey.postSortUpdated)}</option>
						<option value="newest">{i18n(I18nKey.postSortNewest)}</option>
						<option value="oldest">{i18n(I18nKey.postSortOldest)}</option>
						<option value="title">{i18n(I18nKey.postSortTitleAsc)}</option>
					</select>
				</div>
			</div>

			<div class="taxonomy-post-scroll">
				{#if !selectedName}
					<div class="taxonomy-empty">
						<Icon icon="material-symbols:tag" class="empty-icon" />
						<p>{i18n(I18nKey.taxonomyEmptyHint)}</p>
					</div>
				{:else if postsLoading}
					<div class="taxonomy-empty">
						<Icon icon="material-symbols:progress-activity" class="spin" />
					</div>
				{:else}
					<table class="post-list-table">
						<colgroup>
							<col class="post-list-title-col" />
							<col class="post-list-status-col" />
							<col class="post-list-date-col" />
							<col class="post-list-actions-col" />
						</colgroup>
						<thead>
							<tr>
								<th>{i18n(I18nKey.taxonomyPostTitle)}</th>
								<th>{i18n(I18nKey.taxonomyPostStatus)}</th>
								<th>
									{sortBy === "updated"
										? i18n(I18nKey.postSortUpdated)
										: i18n(I18nKey.postSortNewest)}
								</th>
								<th>{i18n(I18nKey.taxonomyPostActions)}</th>
							</tr>
						</thead>
						<tbody>
							{#each pagedPosts as post (post.slug)}
								<tr>
									<td>
										<div class="post-list-title-cell">
											<span class="post-list-pin">
												{#if post.pinned}
													<Icon icon="material-symbols:keep" />
												{/if}
											</span>
											<a
												class="post-list-title-link"
												href={`/admin/posts/edit/${post.slug}/`}
											>
												<strong>{post.title || i18n(I18nKey.taxonomyUntitled)}</strong>
												<span>{post.slug}</span>
											</a>
										</div>
									</td>
									<td>
										<span
											class="post-list-status"
											class:published={!post.draft}
											class:draft={post.draft}
										>
											{post.draft
												? i18n(I18nKey.taxonomyDraftBadge)
												: i18n(I18nKey.postPublished)}
										</span>
									</td>
									<td class="post-list-date">
										{#if post.updated ?? post.published}
											<time dateTime={post.updated ?? post.published}
												>{formatDate(post.updated ?? post.published)}</time
											>
										{:else}
											—
										{/if}
									</td>
									<td>
										<div class="post-list-row-actions">
											<a href={`/admin/posts/edit/${post.slug}/`}>
												{i18n(I18nKey.taxonomyEditPost)}
											</a>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if visiblePosts.length === 0}
						<div class="taxonomy-empty">
							<Icon icon="material-symbols:book-open" class="empty-icon" />
							<p>
								{postSearch.trim()
									? i18n(I18nKey.taxonomyNoMatch)
									: i18n(I18nKey.taxonomyNoPosts)}
							</p>
							{#if postSearch.trim()}
								<button type="button" onclick={clearPostSearch}>
									{i18n(I18nKey.taxonomyClearFilters)}
								</button>
							{:else}
								<a href="/admin/posts/">{i18n(I18nKey.adminPosts)}</a>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

			{#if selectedName && visiblePosts.length > 0}
				<footer class="taxonomy-post-footer">
					{#if totalPages > 1}
						<div class="taxonomy-pager">
							<button
								class="taxonomy-context-action"
								type="button"
								disabled={page <= 1}
								aria-label={i18n(I18nKey.paginationPrev)}
								onclick={() => changePage(page - 1)}
							>
								<Icon icon="material-symbols:chevron-left" />
							</button>
							<span>{page} / {totalPages}</span>
							<button
								class="taxonomy-context-action"
								type="button"
								disabled={page >= totalPages}
								aria-label={i18n(I18nKey.paginationNext)}
								onclick={() => changePage(page + 1)}
							>
								<Icon icon="material-symbols:chevron-right" />
							</button>
						</div>
					{:else}
						<span>
							{i18n(I18nKey.taxonomyPostCount).replace(
								"{count}",
								String(visiblePosts.length),
							)}
						</span>
					{/if}
				</footer>
			{/if}
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
		</div>
	</div>
{/if}

<style>
	/* ── 尺寸单位：对齐参考项目 --taxonomy-unit（随视口缩放）── */
	.taxonomy-browser {
		--tx-unit: clamp(1px, 0.07vw, 1.5px);
		--tx-rule: color-mix(in srgb, var(--content-meta) 20%, transparent);

		display: grid;
		grid-template-columns: calc(225 * var(--tx-unit)) minmax(0, 1fr);
		gap: calc(28 * var(--tx-unit));
		flex: 1;
		min-height: 0;
	}

	/* ── 左栏 ── */
	.taxonomy-explorer {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border-right: 1px solid var(--tx-rule);
		padding-right: calc(20 * var(--tx-unit));
	}

	.taxonomy-nav-scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		padding: 3px;
		margin: -3px;
	}

	.taxonomy-nav-item {
		display: flex;
		align-items: center;
		gap: calc(10 * var(--tx-unit));
		width: 100%;
		min-height: calc(48 * var(--tx-unit));
		padding: calc(12 * var(--tx-unit));
		text-align: left;
		border: none;
		background: transparent;
		color: var(--content-meta);
		border-radius: 10px;
		font-size: calc(14 * var(--tx-unit));
		font-family: inherit;
		cursor: pointer;
		transition:
			background-color 150ms,
			color 150ms;
	}

	.taxonomy-nav-item:hover {
		background: color-mix(in srgb, var(--btn-regular-bg) 50%, transparent);
	}

	.taxonomy-nav-item[aria-pressed="true"] {
		background: var(--btn-regular-bg);
		color: var(--primary);
		font-weight: 500;
	}

	.taxonomy-nav-name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.taxonomy-nav-count {
		text-align: right;
		font-size: calc(12 * var(--tx-unit));
		color: var(--content-meta);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.taxonomy-nav-count small {
		display: block;
		margin-top: calc(4 * var(--tx-unit));
		font-size: 0.95em;
		white-space: nowrap;
	}

	.taxonomy-nav-item[aria-pressed="true"] .taxonomy-nav-count {
		color: var(--primary);
	}

	.taxonomy-uncategorized {
		margin-top: calc(16 * var(--tx-unit));
		padding-top: calc(16 * var(--tx-unit));
		border-top: 1px solid var(--tx-rule);
	}

	.taxonomy-nav-empty {
		padding: 20px 10px;
		font-size: 13px;
		color: var(--content-meta);
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

	/* ── 右栏 ── */
	.taxonomy-results {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}

	.taxonomy-selection-heading {
		display: flex;
		align-items: center;
		gap: calc(12 * var(--tx-unit));
		min-height: calc(36 * var(--tx-unit));
		margin-bottom: calc(18 * var(--tx-unit));
		flex-shrink: 0;
	}

	.taxonomy-selection-heading h2 {
		margin: 0;
		font-size: calc(24 * var(--tx-unit));
		font-weight: 600;
		color: var(--deep-text);
		overflow-wrap: anywhere;
	}

	.taxonomy-context-action {
		display: grid;
		place-items: center;
		width: calc(34 * var(--tx-unit));
		height: calc(34 * var(--tx-unit));
		border: none;
		background: transparent;
		border-radius: 8px;
		color: var(--content-meta);
		flex-shrink: 0;
		cursor: pointer;
		transition: background 150ms, color 150ms;
	}

	.taxonomy-context-action:hover:not(:disabled) {
		color: var(--primary);
		background: var(--btn-regular-bg);
	}

	.taxonomy-context-action:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* 范围切换：下划线 tab（对齐参考项目 .taxonomy-scope-tabs） */
	.taxonomy-scope-tabs {
		display: flex;
		align-items: center;
		gap: calc(28 * var(--tx-unit));
		flex-shrink: 0;
		border-bottom: 1px solid var(--tx-rule);
	}

	.taxonomy-scope-tabs button {
		display: flex;
		align-items: center;
		gap: calc(10 * var(--tx-unit));
		padding: 10px 4px 13px;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		background: transparent;
		color: var(--content-meta);
		font-size: calc(14 * var(--tx-unit));
		font-family: inherit;
		white-space: nowrap;
		cursor: pointer;
		transition: color 150ms, border-color 150ms;
	}

	.taxonomy-scope-tabs button[aria-pressed="true"] {
		color: var(--primary);
		border-bottom-color: var(--primary);
		font-weight: 500;
	}

	.taxonomy-scope-tabs span {
		font-size: 0.9em;
	}

	.taxonomy-scope-hint {
		margin: 12px 0 18px;
		font-size: calc(12 * var(--tx-unit));
		line-height: 1.6;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.taxonomy-post-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: calc(20 * var(--tx-unit));
		margin-bottom: calc(22 * var(--tx-unit));
		flex-shrink: 0;
	}

	/* 搜索框（对齐参考项目 .taxonomy-search） */
	.taxonomy-search {
		display: flex;
		align-items: center;
		gap: calc(10 * var(--tx-unit));
		min-width: 0;
		min-height: calc(42 * var(--tx-unit));
		padding: 0 calc(12 * var(--tx-unit));
		border: 1px solid var(--tx-rule);
		border-radius: 9px;
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		color: var(--content-meta);
		transition: border-color 150ms, box-shadow 150ms;
	}

	.taxonomy-post-controls > .taxonomy-search {
		width: min(100%, calc(340 * var(--tx-unit)));
	}

	.taxonomy-search input {
		width: 100%;
		min-width: 0;
		border: none;
		background: transparent;
		outline: none;
		font-size: calc(14 * var(--tx-unit));
		font-family: inherit;
		color: var(--deep-text);
	}

	.taxonomy-search input::-webkit-search-cancel-button {
		appearance: none;
	}

	.taxonomy-search .search-icon {
		flex-shrink: 0;
	}

	.taxonomy-search button {
		display: grid;
		place-items: center;
		width: 26px;
		height: 32px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--content-meta);
		flex-shrink: 0;
		cursor: pointer;
	}

	.taxonomy-search:focus-within {
		border-color: var(--primary);
		box-shadow: 0 0 0 2px var(--btn-regular-bg);
	}

	.taxonomy-nav-search {
		flex-shrink: 0;
		margin-bottom: calc(14 * var(--tx-unit));
	}

	.taxonomy-sort {
		display: flex;
		align-items: center;
		gap: calc(10 * var(--tx-unit));
		font-size: calc(13 * var(--tx-unit));
		color: var(--content-meta);
		white-space: nowrap;
	}

	.taxonomy-sort-trigger {
		min-height: calc(40 * var(--tx-unit));
		padding: 0 12px;
		border: 1px solid var(--tx-rule);
		border-radius: 9px;
		color: var(--deep-text);
		background: var(--card-bg);
		font-family: inherit;
		font-size: calc(13 * var(--tx-unit));
		cursor: pointer;
	}

	/* 列表滚动区 */
	.taxonomy-post-scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		overflow-anchor: none;
		padding-inline: 3px;
		margin-inline: -3px;
	}

	/* ── 文章表格：数值对齐参考项目 post-manager.css ── */
	.post-list-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
	}

	.post-list-title-col {
		width: 57%;
	}

	.post-list-status-col {
		width: 13%;
	}

	.post-list-date-col {
		width: 17%;
	}

	.post-list-actions-col {
		width: 13%;
	}

	.post-list-table th {
		position: sticky;
		top: 0;
		z-index: 1;
		height: calc(44 * var(--tx-unit));
		padding: 0 calc(12 * var(--tx-unit));
		border-bottom: 1px solid var(--tx-rule);
		background: var(--card-bg);
		color: var(--content-meta);
		font-size: calc(13 * var(--tx-unit));
		font-weight: 500;
		text-align: left;
	}

	.post-list-table td {
		height: calc(76 * var(--tx-unit));
		padding: calc(13 * var(--tx-unit)) calc(12 * var(--tx-unit));
		border-bottom: 1px solid var(--tx-rule);
		vertical-align: middle;
	}

	.post-list-table tr {
		transition: background-color 150ms;
	}

	.post-list-table tbody tr:hover,
	.post-list-table tbody tr:focus-within {
		background: color-mix(in srgb, var(--btn-regular-bg) 60%, transparent);
	}

	.post-list-title-cell {
		display: flex;
		align-items: flex-start;
		gap: calc(12 * var(--tx-unit));
		min-width: 0;
	}

	.post-list-pin {
		width: calc(20 * var(--tx-unit));
		flex-shrink: 0;
		padding-top: 2px;
		color: var(--primary);
	}

	.post-list-title-link {
		display: block;
		min-width: 0;
		text-decoration: none;
	}

	.post-list-title-link strong {
		display: block;
		font-size: calc(14 * var(--tx-unit));
		font-weight: 600;
		line-height: 1.5;
		color: var(--deep-text);
		overflow-wrap: anywhere;
	}

	.post-list-title-link:hover strong {
		color: var(--primary);
	}

	.post-list-title-link > span {
		display: block;
		margin-top: 4px;
		color: var(--content-meta);
		font-size: calc(12 * var(--tx-unit));
		line-height: 1.5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.post-list-status {
		display: inline-flex;
		min-height: calc(24 * var(--tx-unit));
		align-items: center;
		justify-content: center;
		padding: 1px calc(10 * var(--tx-unit));
		font-size: calc(12 * var(--tx-unit));
		font-weight: 500;
		border-radius: calc(20 * var(--tx-unit));
		white-space: nowrap;
	}

	.post-list-status.published {
		background: color-mix(in oklab, var(--success) 15%, transparent);
		color: color-mix(in oklab, var(--success) 65%, var(--deep-text));
	}

	.post-list-status.draft {
		background: var(--btn-regular-bg);
		color: var(--btn-content);
	}

	.post-list-date {
		font-size: calc(12 * var(--tx-unit));
		font-variant-numeric: tabular-nums;
		color: var(--content-meta);
		white-space: nowrap;
	}

	.post-list-row-actions {
		display: flex;
		align-items: center;
		gap: calc(17 * var(--tx-unit));
		font-size: calc(13 * var(--tx-unit));
		color: var(--primary);
	}

	.post-list-row-actions > a {
		padding: calc(8 * var(--tx-unit)) 0;
		white-space: nowrap;
		color: var(--primary);
		text-decoration: none;
	}

	.post-list-row-actions > a:hover {
		text-decoration: underline;
	}

	.taxonomy-post-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: calc(16 * var(--tx-unit));
		flex-shrink: 0;
		min-height: calc(48 * var(--tx-unit));
		border-top: 1px solid var(--tx-rule);
		padding-top: 12px;
		font-size: calc(13 * var(--tx-unit));
		color: var(--content-meta);
	}

	.taxonomy-pager {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.taxonomy-empty {
		min-height: 220px;
		padding: 30px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		font-size: 14px;
		color: var(--content-meta);
		line-height: 1.7;
		text-align: center;
	}

	.taxonomy-empty :is(button, a) {
		color: var(--primary);
	}

	.empty-icon {
		font-size: 1.75rem;
		opacity: 0.6;
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
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}

		.taxonomy-explorer {
			border-right: none;
			border-bottom: 1px solid var(--tx-rule);
			padding-right: 0;
			padding-bottom: calc(12 * var(--tx-unit));
			max-height: 200px;
		}
	}
</style>
