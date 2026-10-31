<script lang="ts">
/**
 * 文章历史版本页 —— 结构照参考
 * src/features/posts/components/post-editor/post-history-page.tsx
 *
 * 参考的布局要点（不要改顺序）：
 *   1. 顶部 header 三段：返回编辑器 ← | 只读标识（锁 + 标题 + 说明） | 恢复此版本按钮
 *   2. 主区 post-history-body：**详情在左占主区**，版本列表在右侧栏（aside）
 *   3. 列表项是链接，点击即导航到 /history/:revisionId，用 URL 表达「选中哪一版」
 *   4. 恢复前弹确认；恢复成功后跳回编辑器
 * 无 revisionId 时对应参考的 PostHistoryIndex：只有返回 + 标题 + 整宽列表。
 */
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let { slug, revisionId = "" }: { slug: string; revisionId?: string } = $props();

type RevisionItem = {
	id: string;
	reason: string;
	savedAt: number;
	title: string;
	category: string;
	tags: string[];
};

let revisions = $state<RevisionItem[]>([]);
let listLoading = $state(true);
let detailHtml = $state("");
let detailLoading = $state(false);
let confirmOpen = $state(false);
let busy = $state(false);
let errorText = $state("");

const editorUrl = `/admin/posts/edit/${encodeURIComponent(slug)}/`;
const historyUrl = `/admin/posts/edit/${encodeURIComponent(slug)}/history/`;

/** 当前查看的版本：初始化自 URL，之后由列表点击原地切换（不整页跳转） */
let currentId = $state(revisionId);

const selected = $derived(revisions.find((r) => r.id === currentId) ?? null);
const canRestore = $derived(Boolean(selected) && !busy);

/** 单次点击即切换：原地加载详情 + replaceState 同步 URL（可刷新/可分享） */
function selectRevision(id: string) {
	currentId = id;
	try {
		window.history.replaceState(
			null,
			"",
			`${historyUrl}${encodeURIComponent(id)}/`,
		);
	} catch {
		// 忽略：URL 同步失败不影响查看
	}
	void loadDetail(id);
}

function fmtTime(ts: number): string {
	if (!ts) return "—";
	const d = new Date(ts);
	return `${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)}`;
}

function reasonLabel(reason: string): string {
	switch (reason) {
		case "publish":
			return i18n(I18nKey.postHistoryReasonPublish);
		case "restore_backup":
			return i18n(I18nKey.postHistoryReasonRestore);
		default:
			return i18n(I18nKey.postHistoryReasonAuto);
	}
}

async function loadList() {
	listLoading = true;
	try {
		const res = await fetch(
			`/api/admin/post-revisions/?slug=${encodeURIComponent(slug)}`,
		);
		const data = await res.json();
		revisions = data.success ? (data.revisions ?? []) : [];
		/* 直接进入分栏：自动选中最新一条，省掉「先看列表页、再点一次」的步骤。
		   这样从编辑器点「历史版本」进来就是「左正文 + 右列表」的成品状态。 */
		if (!currentId && revisions.length > 0) {
			selectRevision(revisions[0].id);
		}
	} catch {
		revisions = [];
	} finally {
		listLoading = false;
	}
}

/** 详情：取全文 → 剥 frontmatter → 走与预览相同的渲染管线 */
async function loadDetail(id: string) {
	if (!id) {
		detailHtml = "";
		return;
	}
	detailLoading = true;
	detailHtml = "";
	try {
		const res = await fetch(
			`/api/admin/post-revisions/?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`,
		);
		const data = await res.json();
		if (!data.success) return;
		const body = String(data.content ?? "").replace(
			/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
			"",
		);
		const pres = await fetch("/api/admin/preview/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: body }),
		});
		const pdata = await pres.json();
		detailHtml = pdata.success ? (pdata.html ?? "") : "";
	} catch {
		detailHtml = "";
	} finally {
		detailLoading = false;
	}
}

async function doRestore() {
	confirmOpen = false;
	if (!selected) return;
	busy = true;
	errorText = "";
	try {
		const res = await fetch("/api/admin/post-revisions/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug, id: selected.id }),
		});
		const data = await res.json();
		if (data.success) {
			// 对应参考的 onRestored: goEditor
			window.location.href = editorUrl;
			return;
		}
		errorText = data.message ?? "";
	} catch {
		errorText = i18n(I18nKey.taxonomyLoadFailed);
	} finally {
		busy = false;
	}
}

$effect(() => {
	void loadList();
});

$effect(() => {
	if (currentId) void loadDetail(currentId);
});
</script>

<div class="history-page">
	<header class="history-header">
		<a class="history-back" href={editorUrl}>
			<Icon icon="material-symbols:arrow-back" />
			{i18n(I18nKey.postHistoryBack)}
		</a>

		{#if currentId}
			<div class="history-context">
				<Icon icon="material-symbols:lock" />
				<div>
					<h1>{i18n(I18nKey.postHistoryReadonly)}</h1>
					<p>{i18n(I18nKey.postHistoryRestoreHint)}</p>
				</div>
			</div>
		{:else}
			<h1 class="history-title">{i18n(I18nKey.postHistory)}</h1>
		{/if}

		<div class="history-actions">
			{#if currentId}
				<button
					class="history-restore-this"
					type="button"
					disabled={!canRestore}
					onclick={() => (confirmOpen = true)}
				>
					{i18n(I18nKey.postHistoryRestoreThis)}
				</button>
			{/if}
		</div>
	</header>

	{#if currentId}
		<!-- 主区：详情在左，列表在右（照参考 post-history-body 的顺序） -->
		<div class="history-body">
			<section class="history-content">
				{#if detailLoading}
					<p class="history-note">…</p>
				{:else if !selected}
					<p class="history-note">{i18n(I18nKey.postHistoryEmpty)}</p>
				{:else}
					<h2 class="history-doc-title">{selected.title || "—"}</h2>
					<!-- 正文里的横幅跟标题左对齐（参考是 h2 下方的 p）；
					     居中的那个是 header 中段的只读标识，两者不要混用同一条规则 -->
					<p class="history-banner">
						{i18n(I18nKey.postHistoryBannerTitle).replace(
							"{time}",
							fmtTime(selected.savedAt),
						)}
						· {reasonLabel(selected.reason)}
					</p>
					<div class="history-meta">
						<span>
							<Icon icon="material-symbols:menu-book" />
							{selected.category || "—"}
						</span>
						{#if selected.tags.length}
							<span class="history-meta-tags">
								<Icon icon="material-symbols:label" />
								{selected.tags.join(" · ")}
							</span>
						{/if}
					</div>
					<!-- biome-ignore lint/security/noDangerouslySetInnerHtml: 服务端渲染管线产出的可信 HTML -->
					<div class="history-doc custom-md">{@html detailHtml}</div>
				{/if}
			</section>

			<aside class="history-sidebar">
				<h2 class="history-sidebar-title">
					{i18n(I18nKey.postHistoryListTitle)}
				</h2>
				{#if listLoading}
					<p class="history-note">…</p>
				{:else if revisions.length === 0}
					<p class="history-note">{i18n(I18nKey.postHistoryEmpty)}</p>
				{:else}
					<nav class="history-list">
						{#each revisions as item (item.id)}
							<button
								type="button"
								class="history-version"
								class:is-selected={item.id === currentId}
								aria-current={item.id === currentId ? "true" : undefined}
								onclick={() => selectRevision(item.id)}
							>
								<time class="history-time">{fmtTime(item.savedAt)}</time>
								<span class="history-reason">{reasonLabel(item.reason)}</span>
								<span class="history-version-title">{item.title || "—"}</span>
							</button>
						{/each}
					</nav>
				{/if}
			</aside>
		</div>
	{:else}
		<!-- 没有可查看的版本（或列表还在加载）：给出明确空态，不留整页空白 -->
		<p class="history-note history-empty">
			{listLoading ? "…" : i18n(I18nKey.postHistoryEmpty)}
		</p>
	{/if}

	{#if errorText}
		<p class="history-error">{errorText}</p>
	{/if}
</div>

{#if confirmOpen}
	<div
		class="history-overlay"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) confirmOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") confirmOpen = false;
		}}
	>
		<div class="history-confirm">
			<h3>{i18n(I18nKey.postHistoryRestoreTitle)}</h3>
			<p class="history-note">{i18n(I18nKey.postHistoryRestoreMessage)}</p>
			<div class="history-confirm-actions">
				<button
					class="history-btn"
					type="button"
					onclick={() => (confirmOpen = false)}
				>
					{i18n(I18nKey.taxonomyCancel)}
				</button>
				<button class="history-btn is-primary" type="button" onclick={doRestore}>
					{i18n(I18nKey.postHistoryRestoreThis)}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* 外层容器与编辑器 .editor-shell 同规格：等高、卡片底、描边、大圆角、卡片阴影。
	   历史页此前只是一层裸 flex，没有外壳，视觉上与编辑页/列表页不成体系。 */
	.history-page {
		display: flex;
		flex-direction: column;
		gap: 0;
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	/* header 三段：返回 | 只读标识 | 恢复按钮（照参考 post-editor-header 的排布） */
	.history-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-shrink: 0;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--line-divider);
		border-radius: var(--radius-large) var(--radius-large) 0 0;
	}

	.history-back {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--content-meta);
		font-size: 0.875rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.history-back:hover {
		color: var(--primary);
	}

	/* 只读标识居中：照参考 .post-history-context 的 margin-inline: auto，
	   不论窗口多宽都保持在 header 正中，不随左右两侧内容宽度漂移 */
	.history-context {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
		margin-inline: auto;
		text-align: center;
		color: var(--content-meta);
	}

	.history-context svg {
		flex-shrink: 0;
	}

	.history-context h1 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
	}

	.history-context p {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
	}

	.history-title {
		flex: 1;
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.history-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.history-restore-this {
		display: inline-flex;
		align-items: center;
		height: 2.25rem;
		padding: 0 1.25rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--primary);
		color: var(--primary-foreground);
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.history-restore-this:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* 主区：flex（参考 .post-history-body 用 flex，不是 grid）；
	   详情占满剩余，列表固定 20rem 右栏 */
	.history-body {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.history-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		/* 照参考 .post-editor-document：正文限宽 66rem 并居中，
		   左右内边距取 max(3rem, (100% - 66rem)/2)，避免长行铺满整屏难读 */
		--document-inset: max(3rem, calc((100% - 66rem) / 2));
		padding: 3.75rem var(--document-inset) 3rem;
	}

	.history-doc-title {
		margin: 0 0 0.25rem;
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	/* 空态落在卡片里，需要与主区一致的留白 */
	.history-empty {
		flex: 1;
		padding: 2.5rem 1.5rem;
		text-align: center;
	}

	/* 右栏：照参考 .post-history-sidebar —— 20rem 固定宽、左侧分隔线、
	   比卡片略深的背景色，让列表与正文明确分区 */
	.history-sidebar {
		display: flex;
		flex-direction: column;
		width: 20rem;
		flex-shrink: 0;
		min-height: 0;
		border-left: 1px solid var(--line-divider);
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
	}

	.history-sidebar-title {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--content-meta);
	}

	/* 列表容器：照参考 .post-history-list 的 padding（左宽右窄，为时间轴留位） */
	.history-list {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		padding: 0.5rem 1.25rem 1.5rem 2rem;
	}

	/* 列表项：照参考 .post-history-version —— 0.625rem 圆角、1rem/1.125rem 内边距、
	   0.75rem 间距，并用 ::before 画左侧时间轴竖线 */
	.history-version {
		position: relative;
		display: block;
		width: 100%;
		margin-bottom: 0.75rem;
		padding: 1rem 1.125rem;
		border: none;
		border-radius: 0.625rem;
		background: transparent;
		font-family: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.history-version::before {
		content: "";
		position: absolute;
		left: -0.625rem;
		top: 0;
		bottom: -0.75rem;
		width: 1px;
		background: var(--line-divider);
	}

	.history-version:hover {
		background: color-mix(in oklab, var(--btn-regular-bg) 60%, transparent);
	}

	.history-version.is-selected {
		background: var(--btn-regular-bg);
	}

	.history-version.is-selected .history-time {
		color: var(--primary);
	}

	.history-time {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
	}

	.history-reason {
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.history-version-title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.history-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.history-meta span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* 提示文本居中（仅用于 header 中段的只读标识与空态） */
	.history-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		text-align: center;
	}

	/* 正文横幅：左对齐，跟在标题下方（对应参考 h2 之后的 p） */
	.history-banner {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		text-align: left;
	}

	/* 正文排版：照参考 .post-editor-document .tiptap 的 1.0625rem / 1.85 行高，
	   并给段落、列表、标题补上下间距，避免整页文字挤成一团 */
	.history-doc {
		margin-top: 1rem;
		font-size: 1.0625rem;
		line-height: 1.85;
	}

	.history-doc :global(p) {
		margin: 0 0 1.25rem;
	}

	.history-doc :global(h2) {
		margin: 2rem 0 0.875rem;
		font-size: 1.375rem;
		line-height: 1.4;
	}

	.history-doc :global(h3) {
		margin: 1.75rem 0 0.75rem;
		font-size: 1.1875rem;
		line-height: 1.45;
	}

	.history-doc :global(ul),
	.history-doc :global(ol) {
		margin: 0 0 1.25rem;
		padding-left: 1.5rem;
	}

	.history-doc :global(li) {
		margin-bottom: 0.5rem;
	}

	.history-doc :global(blockquote) {
		margin: 0 0 1.25rem;
		padding: 0.25rem 0 0.25rem 1rem;
		border-left: 3px solid var(--line-divider);
	}

	.history-doc :global(pre) {
		margin: 0 0 1.25rem;
	}

	.history-doc :global(img) {
		margin: 1.25rem 0;
	}

	.history-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--destructive);
	}

	.history-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.3);
	}

	.history-confirm {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: min(clamp(420px, 30vw, 520px), calc(100% - 32px));
		padding: clamp(24px, 1.5vw, 32px);
		border-radius: var(--radius-large);
		background: var(--card-bg);
		box-shadow: 0 16px 40px rgb(0 0 0 / 0.3);
	}

	.history-confirm h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.history-confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.history-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.history-btn.is-primary {
		border-color: transparent;
		background: var(--primary);
		color: var(--primary-foreground);
	}
</style>
