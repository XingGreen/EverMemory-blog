<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { TaxonomyKind } from "@/utils/taxonomy";

/**
 * 分类 / 标签管理面板（两个路由共用，靠 kind 区分）
 *
 * 形态借鉴参考项目的 taxonomy-workspace：左侧列表 + 右侧文章预览。
 * 但本项目分类/标签是 frontmatter 聚合值，无独立实体表，
 * 因此这里做成单栏列表 + 行内操作，不做右侧文章预览
 * （预览需额外接口，且与「增删改」这一核心诉求无关）。
 */
let {
	kind,
	title,
	intro,
	onNotify,
}: {
	kind: TaxonomyKind;
	title: string;
	intro: string;
	onNotify: (message: string, type: "success" | "error") => void;
} = $props();

type Entry = {
	name: string;
	kind: TaxonomyKind;
	count: number;
	draftCount: number;
};

let entries = $state<Entry[]>([]);
let uncategorizedCount = $state(0);
let loading = $state(true);
let loadError = $state("");
let search = $state("");

// 弹窗状态
let dialogMode = $state<"" | "create" | "rename" | "delete">("");
let dialogName = $state("");
let dialogOriginal = $state("");
let dialogBusy = $state(false);
let dialogError = $state("");

const filtered = $derived(
	entries
		.filter((e) => e.kind === kind)
		.filter((e) =>
			search.trim()
				? e.name.toLowerCase().includes(search.trim().toLowerCase())
				: true,
		),
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
	} catch {
		loadError = i18n(I18nKey.taxonomyLoadFailed);
	} finally {
		loading = false;
	}
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
		dialogMode = "";
		await load();
	} catch {
		dialogError = i18n(I18nKey.taxonomyLoadFailed);
	} finally {
		dialogBusy = false;
	}
}

$effect(() => {
	void load();
});
</script>

<div class="taxonomy-toolbar">
	<div class="ui-search taxonomy-search">
		<Icon icon="material-symbols:search" class="search-icon" />
		<input
			type="search"
			bind:value={search}
			placeholder={i18n(I18nKey.taxonomySearch)}
			aria-label={i18n(I18nKey.taxonomySearch)}
		/>
	</div>
	<button class="ui-btn ui-btn-primary" type="button" onclick={openCreate}>
		<Icon icon="material-symbols:add" class="btn-icon" />
		{i18n(I18nKey.taxonomyNew)}
	</button>
</div>

{#if loading}
	<div class="taxonomy-state">
		<Icon icon="material-symbols:progress-activity" class="spin" />
		<span>{i18n(I18nKey.configLoading)}</span>
	</div>
{:else if loadError}
	<div class="taxonomy-state error">
		<Icon icon="material-symbols:error-outline" />
		<span>{loadError}</span>
		<button class="ui-btn ui-btn-soft" type="button" onclick={load}>
			{i18n(I18nKey.secretsReload)}
		</button>
	</div>
{:else if filtered.length === 0}
	<div class="taxonomy-state">
		<Icon icon="material-symbols:inbox-outline" />
		<div>
			<p class="state-title">
				{search.trim()
					? i18n(I18nKey.taxonomyNoMatch)
					: i18n(I18nKey.taxonomyEmpty)}
			</p>
			{#if !search.trim()}
				<p class="state-hint">{i18n(I18nKey.taxonomyEmptyHint)}</p>
			{/if}
		</div>
	</div>
{:else}
	<ul class="taxonomy-list">
		{#each filtered as entry (entry.name)}
			<li class="taxonomy-item">
				<div class="item-main">
					<span class="item-name">{entry.name}</span>
					<span class="item-count">
						{i18n(I18nKey.taxonomyPostCount).replace(
							"{count}",
							String(entry.count),
						)}
					</span>
				</div>
				<div class="item-actions">
					<button
						class="icon-btn"
						type="button"
						title={i18n(I18nKey.taxonomyRename)}
						aria-label={i18n(I18nKey.taxonomyRename)}
						onclick={() => openRename(entry.name)}
					>
						<Icon icon="material-symbols:edit-outline" />
					</button>
					<button
						class="icon-btn danger"
						type="button"
						title={i18n(I18nKey.taxonomyDelete)}
						aria-label={i18n(I18nKey.taxonomyDelete)}
						onclick={() => openDelete(entry.name)}
					>
						<Icon icon="material-symbols:delete-outline" />
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}

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
		</div>
	</div>
{/if}

<style>
	.taxonomy-toolbar {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-shrink: 0;
	}

	.taxonomy-search {
		flex: 1;
		min-width: 0;
	}

	.taxonomy-search .search-icon {
		flex-shrink: 0;
	}

	.taxonomy-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		padding: 3rem 1rem;
		color: var(--content-meta);
		font-size: 0.875rem;
		flex-direction: column;
		text-align: center;
	}

	.taxonomy-state.error {
		color: var(--destructive);
	}

	.state-title {
		margin: 0;
		font-weight: 500;
	}

	.state-hint {
		margin: 0.375rem 0 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.taxonomy-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		overflow-y: auto;
		min-height: 0;
	}

	.taxonomy-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--content-meta) 6%, transparent);
		transition: background 0.15s ease;
	}

	.taxonomy-item:hover {
		background: color-mix(in srgb, var(--content-meta) 10%, transparent);
	}

	.item-main {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		min-width: 0;
	}

	.item-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.item-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
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

	.icon-btn:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.icon-btn.danger:hover {
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

	/* 弹窗 */
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
</style>
