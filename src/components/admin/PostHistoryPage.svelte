<script lang="ts">
/**
 * 文章历史版本页
 *
 * 结构、类名、样式数值全部来自参考项目：
 *   src/features/posts/components/post-editor/post-history-page.tsx
 *   src/features/posts/components/post-editor/post-editor.css（post-editor-* / post-history-*）
 *
 * 只做了一件事：把 --fuwari-* 设计变量映射到本项目同名变量，其余原样照抄。
 * 不再有自创的 .history-page / .history-body 那套命名与布局。
 *
 * 参考布局要点：
 *   1. header 三段：返回 ← ｜ 只读标识（居中，margin-inline:auto）｜ 恢复此版本（margin-left:auto）
 *   2. 主区 flex：左 .post-history-content（内含 .post-editor-document 负责滚动与 66rem 限宽）
 *      右 .post-history-sidebar（20rem 固定宽）
 *   3. 列表项是带描边的卡片块，::before 画左侧时间轴
 */
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let { slug, revisionId = "" }: { slug: string; revisionId?: string } = $props();

type Revision = {
	id: string;
	reason: string;
	savedAt: number;
	title: string;
	category: string;
	tags: string[];
	image: string;
};

let revisions = $state<Revision[]>([]);
let listLoading = $state(true);
let detailHtml = $state("");
let detailLoading = $state(false);
let currentId = $state(revisionId);
let confirmOpen = $state(false);
let deleteConfirmOpen = $state(false);
let busy = $state(false);
let deleting = $state(false);
/** 错误态：按参考分成三种，前端据 message 映射 */
let errorKind = $state<
	"" | "post-not-found" | "revision-not-found" | "generic"
>("");

const errorText = $derived(
	errorKind === "post-not-found"
		? i18n(I18nKey.postHistoryErrorPostNotFound)
		: errorKind === "revision-not-found"
			? i18n(I18nKey.postHistoryErrorRevisionNotFound)
			: errorKind === "generic"
				? i18n(I18nKey.taxonomyLoadFailed)
				: "",
);

const editorUrl = `/admin/posts/edit/${encodeURIComponent(slug)}/`;
const historyUrl = `/admin/posts/edit/${encodeURIComponent(slug)}/history/`;

/* 正文限宽可拖拽，与编辑页共用同一个 localStorage 键，宽度偏好两处一致 */
const WIDTH_KEY = "admin-editor-max-width";
/* 正文最小宽度：与编辑页一致，到达该值后拖拽不再继续缩小 */
const WIDTH_MIN = 400;

function readWidth(): number | null {
	try {
		const raw = Number(localStorage.getItem(WIDTH_KEY));
		return Number.isFinite(raw) && raw >= WIDTH_MIN ? raw : null;
	} catch {
		return null;
	}
}

let contentWidth = $state<number | null>(readWidth());
let resizing = $state(false);

function startResize(e: PointerEvent, side: "left" | "right") {
	e.preventDefault();
	resizing = true;
	const startX = e.clientX;
	const startW =
		contentWidth ?? (typeof window === "undefined" ? 1056 : window.innerWidth);
	const viewport = typeof window === "undefined" ? 1920 : window.innerWidth;
	const mySide = side;
	const move = (ev: PointerEvent) => {
		const delta = (ev.clientX - startX) * (mySide === "right" ? 1 : -1);
		const next = startW + delta * 2;
		/* 先按视口收敛，再兜底最小宽度 */
		contentWidth = Math.max(WIDTH_MIN, Math.min(viewport, next));
	};
	const up = () => {
		resizing = false;
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		try {
			if (contentWidth !== null)
				localStorage.setItem(WIDTH_KEY, String(contentWidth));
		} catch {
			// 忽略存储失败
		}
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
}

const selected = $derived(revisions.find((r) => r.id === currentId) ?? null);

function fmtTime(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
		d.getDate(),
	).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
		d.getMinutes(),
	).padStart(2, "0")}`;
}

/** 只到日的日期，对应前台 formatDateToYYYYMMDD 的展示口径 */
function fmtDate(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts);
	return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
		d.getDate(),
	).padStart(2, "0")}`;
}

function reasonLabel(reason: string): string {
	if (reason === "publish") return i18n(I18nKey.postHistoryReasonPublish);
	if (reason === "restore_backup")
		return i18n(I18nKey.postHistoryReasonRestore);
	return i18n(I18nKey.postHistoryReasonAuto);
}

async function loadList() {
	listLoading = true;
	try {
		const res = await fetch(
			`/api/admin/post-revisions/?slug=${encodeURIComponent(slug)}`,
		);
		const data = await res.json();
		revisions = data.success ? (data.revisions ?? []) : [];
		if (!currentId && revisions.length > 0) selectRevision(revisions[0].id);
	} catch {
		revisions = [];
	} finally {
		listLoading = false;
	}
}

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

function selectRevision(id: string) {
	currentId = id;
	try {
		window.history.replaceState(
			null,
			"",
			`${historyUrl}${encodeURIComponent(id)}/`,
		);
	} catch {
		// URL 同步失败不影响查看
	}
	void loadDetail(id);
}

async function doRestore() {
	confirmOpen = false;
	if (!selected) return;
	busy = true;
	errorKind = "";
	try {
		const res = await fetch("/api/admin/post-revisions/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug, id: selected.id }),
		});
		const data = await res.json();
		if (data.success) {
			window.location.href = editorUrl;
			return;
		}
		// 对应参考的 getRestoreErrorMessage：404 分「文章没了」和「版本没了」
		const msg = String(data.message ?? "");
		errorKind =
			res.status === 404
				? msg.includes("版本")
					? "revision-not-found"
					: "post-not-found"
				: "generic";
	} catch {
		errorKind = "generic";
	} finally {
		busy = false;
	}
}

/** 删除版本：对应参考 deleteMutation（成功后若删的是当前项，自动切到下一条） */
async function doDelete() {
	deleteConfirmOpen = false;
	if (!selected) return;
	const targetId = selected.id;
	deleting = true;
	errorKind = "";
	try {
		const res = await fetch("/api/admin/post-revisions/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug, id: targetId, action: "delete" }),
		});
		const data = await res.json();
		if (!data.success) {
			errorKind =
				String(data.message ?? "") === "REVISION_NOT_FOUND"
					? "revision-not-found"
					: "generic";
			return;
		}
		const rest = revisions.filter((r) => r.id !== targetId);
		revisions = rest;
		if (rest.length > 0) selectRevision(rest[0].id);
		else {
			currentId = "";
			detailHtml = "";
		}
	} catch {
		errorKind = "generic";
	} finally {
		deleting = false;
	}
}

$effect(() => {
	void loadList();
});

$effect(() => {
	if (currentId) void loadDetail(currentId);
});
</script>

<!-- 对应参考的 <div className="post-editor-workspace fuwari-card-base"> -->
<div class="post-editor-workspace post-history-shell">
	<header class="post-editor-header post-history-header">
		<a class="post-editor-back" href={editorUrl}>
			<Icon icon="material-symbols:arrow-back" />
			{i18n(I18nKey.postHistoryBack)}
		</a>

		<div class="post-history-context">
			<Icon icon="material-symbols:lock" />
			<div>
				<h1>{i18n(I18nKey.postHistoryReadonly)}</h1>
				<p>{i18n(I18nKey.postHistoryRestoreHint)}</p>
			</div>
		</div>

		<div class="post-editor-header-actions">
			<button
				class="post-editor-restore"
				type="button"
				disabled={!selected || busy}
				onclick={() => (confirmOpen = true)}
			>
				{i18n(I18nKey.postHistoryRestoreThis)}
			</button>
		</div>
	</header>

	<div
		class="post-history-body"
		class:is-resizing={resizing}
		style={`--history-doc-width: ${contentWidth === null ? "none" : `${contentWidth}px`}`}
	>
		<!-- 左右拖拽手柄：移植自编辑页 .resize-handle，交互一致（向内拖=变窄） -->
		<button
			class="resize-handle left"
			type="button"
			aria-label={i18n(I18nKey.postResizeEditor)}
			title={i18n(I18nKey.postResizeEditor)}
			onpointerdown={(e) => startResize(e, "left")}
		></button>
		<button
			class="resize-handle right"
			type="button"
			aria-label={i18n(I18nKey.postResizeEditor)}
			title={i18n(I18nKey.postResizeEditor)}
			onpointerdown={(e) => startResize(e, "right")}
		></button>
		<section class="post-history-content">
			<!-- 滚动与限宽都交给 .post-editor-document（参考同款），
			     不再由外层 section 承担，避免滚动条挤在正文与右栏之间 -->
			<div class="post-editor-document">
				{#if detailLoading}
					<p class="post-history-note">…</p>
				{:else if !selected}
					<p class="post-history-note">{i18n(I18nKey.postHistoryEmpty)}</p>
				{:else}
					<h2 class="post-editor-title">{selected.title || "—"}</h2>
					<p class="post-history-banner">
						{i18n(I18nKey.postHistoryBannerTitle).replace(
							"{time}",
							fmtTime(selected.savedAt),
						)}
						· {reasonLabel(selected.reason)}
					</p>
					<!-- 元数据栏：结构与图标全部照搬前台 src/components/layout/PostMeta.astro
					     日期（calendar-today-outline-rounded）/ 分类（book-2-outline-rounded）/
					     标签（tag-rounded，用「/」分隔）。前台该栏没有封面项，故不渲染封面。 -->
					<div class="post-meta-root">
						<div class="post-meta-item">
							<div class="meta-icon">
								<Icon icon="material-symbols:calendar-today-outline-rounded" />
							</div>
							<span>{fmtDate(selected.savedAt)}</span>
						</div>
						<div class="post-meta-item">
							<div class="meta-icon">
								<Icon icon="material-symbols:book-2-outline-rounded" />
							</div>
							<span>
								{selected.category || i18n(I18nKey.postCategoryPlaceholder)}
							</span>
						</div>
						<div class="post-meta-item">
							<div class="meta-icon">
								<Icon icon="material-symbols:tag-rounded" />
							</div>
							{#if selected.tags.length > 0}
								{#each selected.tags as tag, i (tag)}
									{#if i > 0}
										<span class="post-meta-divider">/</span>
									{/if}
									<span>{tag.trim()}</span>
								{/each}
							{:else}
								<span>{i18n(I18nKey.postMetaTagsEmpty)}</span>
							{/if}
						</div>
					</div>
					<!-- 渲染容器与编辑页预览完全同一组 class：
					     src/components/admin/PostEditorWritePanel.svelte:201
					     "prose dark:prose-invert prose-base max-w-none! content-preview custom-md"
					     prose / prose-base 负责行高与段落间距，此前漏了它们才显得挤。 -->
					<div
						class="prose dark:prose-invert prose-base max-w-none post-editor-body custom-md"
					>
						{@html detailHtml}
					</div>
				{/if}
			</div>
		</section>

		<aside class="post-history-sidebar">
			<h2 class="post-editor-panel-heading">
				{i18n(I18nKey.postHistoryListTitle)}
			</h2>
			<div class="post-history-list">
				{#if listLoading}
					<p class="post-history-note">…</p>
				{:else if revisions.length === 0}
					<p class="post-history-note">{i18n(I18nKey.postHistoryEmpty)}</p>
				{:else}
					{#each revisions as item (item.id)}
						<button
							type="button"
							class="post-history-version"
							class:is-active={item.id === currentId}
							onclick={() => selectRevision(item.id)}
						>
							<time class="post-history-time">{fmtTime(item.savedAt)}</time>
							<span class="post-history-reason">{reasonLabel(item.reason)}</span>
							<span class="post-history-version-title">{item.title || "—"}</span>
						</button>
					{/each}
				{/if}
			</div>
			<!-- 参考 deleteAction：侧栏底部整宽按钮，危险色 + 顶部分隔线 -->
			<button
				class="post-history-delete"
				type="button"
				disabled={!selected || deleting}
				onclick={() => (deleteConfirmOpen = true)}
			>
				<Icon icon="material-symbols:delete" />
				{i18n(I18nKey.postHistoryDeleteAction)}
			</button>
		</aside>
	</div>

	{#if errorText}
		<p class="post-history-error">{errorText}</p>
	{/if}
</div>

{#if deleteConfirmOpen}
	<div
		class="post-history-overlay"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) deleteConfirmOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") deleteConfirmOpen = false;
		}}
	>
		<div class="post-history-confirm">
			<h3>{i18n(I18nKey.postHistoryDeleteTitle)}</h3>
			<p>{i18n(I18nKey.postHistoryDeleteMessage)}</p>
			<div class="post-history-confirm-actions">
				<button type="button" onclick={() => (deleteConfirmOpen = false)}>
					{i18n(I18nKey.taxonomyCancel)}
				</button>
				<button class="is-danger" type="button" onclick={doDelete}>
					{i18n(I18nKey.postHistoryDeleteAction)}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if confirmOpen}
	<div
		class="post-history-overlay"
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
		<div class="post-history-confirm">
			<h3>{i18n(I18nKey.postHistoryRestoreTitle)}</h3>
			<p>{i18n(I18nKey.postHistoryRestoreMessage)}</p>
			<div class="post-history-confirm-actions">
				<button type="button" onclick={() => (confirmOpen = false)}>
					{i18n(I18nKey.taxonomyCancel)}
				</button>
				<button class="is-primary" type="button" onclick={doRestore}>
					{i18n(I18nKey.postHistoryRestoreThis)}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── 变量映射：把参考的 --fuwari-* 换成本项目同名变量，其余原样 ── */
	.post-history-shell {
		/* 参考 .post-editor-workspace */
		--post-editor-rule: color-mix(in srgb, var(--deep-text) 8%, transparent);
		--post-editor-header-height: 4.75rem;
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		/* fuwari-card-base 的等价物：卡片底 + 描边 + 大圆角 + 阴影 */
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	/* 参考 .post-editor-header */
	.post-editor-header {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		gap: 1rem;
		min-height: var(--post-editor-header-height);
		padding: 1rem 1.75rem;
		border-bottom: 1px solid var(--post-editor-rule);
	}

	/* 参考 .post-editor-back */
	.post-editor-back {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem;
		border-radius: 0.5rem;
		white-space: nowrap;
		font-size: 0.875rem;
		color: var(--content-meta);
		text-decoration: none;
	}

	.post-editor-back:hover {
		background: var(--btn-regular-bg);
		color: var(--btn-content);
	}

	/* 参考 .post-history-context：margin-inline:auto 居中 */
	.post-history-context {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
		margin-inline: auto;
		color: var(--content-meta);
	}

	.post-history-context :global(svg) {
		flex-shrink: 0;
	}

	.post-history-context h1 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
	}

	.post-history-context p {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
	}

	/* 参考 .post-editor-header-actions */
	.post-editor-header-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-left: auto;
	}

	.post-editor-restore {
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

	.post-editor-restore:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* 参考 .post-history-body */
	.post-history-body {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
	}

	/* 拖拽手柄：移植自编辑页，10px 热区 + col-resize 光标 */
	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 30;
		width: 10px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: col-resize;
		touch-action: none;
	}

	.resize-handle.left {
		left: 0;
	}

	.resize-handle.right {
		right: 20rem;
	}

	.resize-handle:hover,
	.post-history-body.is-resizing .resize-handle {
		background: color-mix(in srgb, var(--primary) 22%, transparent);
	}

	/* 参考 .post-history-content */
	.post-history-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}

	/* 正文内边距对齐编辑页：.write-panel 的 padding 1.25rem 1.5rem
	   与 .content-preview 的 padding 1.25rem 相加 —— 上 2.5rem、左右 2.75rem */
	.post-editor-document {
		flex: 1;
		min-height: 0;
		padding: 2.5rem 2.75rem;
		overflow-y: auto;
		border: none;
		border-radius: var(--radius-md);
		background: none;
	}

	/* 拖拽调宽：默认不限宽（与编辑页一致），拖过之后才按记忆值限宽并居中 */
	.post-history-body .post-editor-document {
		max-width: var(--history-doc-width, none);
		margin-inline: auto;
		width: 100%;
	}

	/* 参考 .post-editor-title */
	.post-editor-title {
		margin: 0 0 1rem;
		padding: 0;
		font-size: 2.25rem;
		line-height: 1.4;
		font-weight: 700;
		letter-spacing: -0.025em;
		color: var(--deep-text);
	}

	.post-history-banner {
		/* 参考里紧跟标题的说明行：小字、次级色、左对齐 */
		margin: -0.5rem 0 0.75rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	/* 元数据栏：抄前台 PostMeta.astro + main.css 442-449 的 .meta-icon。
	   分隔线挂在栏底（与正文隔开），并允许换行：窄屏挤不下时自动折行。 */
	.post-meta-root {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-start;
		gap: 0.75rem 1.25rem;
		margin: 0 0 1.5rem;
		padding: 0 0 1.25rem;
		border-bottom: 1px solid var(--post-editor-rule);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--content-meta);
	}

	/* 窄屏收紧间距，尽量在折行前多放一项 */
	@media (max-width: 900px) {
		.post-meta-root {
			gap: 0.5rem 0.875rem;
		}
	}

	.post-meta-item {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-shrink: 0;
		max-width: 100%;
		min-width: 0;
	}

	.meta-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		margin-right: 0.5rem;
		border-radius: 0.375rem;
		background: var(--btn-regular-bg);
		/* --btn-content 在本项目未定义时会回落到纯黑，深色主题下看不见图标 */
		color: var(--btn-content, var(--deep-text));
		transition: colors 0.15s;
	}

	.post-meta-item :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
		fill: currentcolor;
	}

	/* 标签之间的「/」分隔 */
	.post-meta-divider {
		margin-inline: 0.375rem;
		color: var(--line-divider);
	}

	/* 正文：行高与段落间距由 prose / prose-base 负责（与编辑页预览同一组 class），
	   这里只补颜色，避免深色主题下正文发暗。 */
	.post-editor-body {
		color: var(--deep-text);
	}

	/* 参考 .post-history-sidebar */
	.post-history-sidebar {
		display: flex;
		flex-direction: column;
		width: 20rem;
		flex-shrink: 0;
		min-height: 0;
		border-left: 1px solid var(--post-editor-rule);
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
	}

	/* 参考 .post-editor-panel-heading */
	.post-editor-panel-heading {
		flex-shrink: 0;
		margin: 0;
		padding: 1rem 1.25rem 0.75rem 2rem;
		border-bottom: 1px solid var(--post-editor-rule);
		background: var(--card-bg);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--content-meta);
	}

	/* 参考 .post-history-list */
	.post-history-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.5rem 1.25rem 1.5rem 2rem;
	}

	/* 参考 .post-history-version：只有圆角 + 内边距 + 块间距 + 时间轴，
	   没有描边、没有卡片底；选中态只改圆点颜色（见 .is-active::after） */
	.post-history-version {
		position: relative;
		display: block;
		width: 100%;
		padding: 1rem 1.125rem;
		margin-bottom: 0.75rem;
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

	/* 时间轴：竖线（::before）+ 节点圆点（::after），
	   末项的竖线只画到节点处，不拖到底——三条规则都照参考 296-330 行 */
	.post-history-version::before {
		content: "";
		position: absolute;
		left: -0.625rem;
		top: 0;
		bottom: -0.75rem;
		width: 1px;
		background: var(--post-editor-rule);
	}

	.post-history-version:last-child::before {
		bottom: calc(100% - 2rem);
	}

	.post-history-version::after {
		content: "";
		position: absolute;
		left: calc(-0.625rem - 3px);
		top: 1.625rem;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--deep-text) 30%, transparent);
	}

	.post-history-version.is-active::after {
		background: var(--primary);
	}

	/* 选中态只改圆点（参考 .is-selected::after），不改文字颜色 */

	.post-history-time {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
	}

	.post-history-reason {
		display: block;
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.post-history-version-title {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	/* 参考 .post-history-delete */
	.post-history-delete {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
		width: 100%;
		padding: 1.25rem 1.5rem;
		border: none;
		border-top: 1px solid var(--post-editor-rule);
		background: transparent;
		font-family: inherit;
		font-size: 0.8125rem;
		color: var(--destructive);
		cursor: pointer;
	}

	.post-history-delete:hover {
		background: color-mix(in srgb, var(--destructive) 12%, transparent);
	}

	.post-history-delete:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* 参考 .post-history-note */
	/* 参考 .post-history-note */
	.post-history-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.post-history-error {
		margin: 0;
		padding: 0 1.75rem 1rem;
		font-size: 0.8125rem;
		color: var(--destructive);
	}

	/* 恢复确认 */
	.post-history-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.3);
	}

	.post-history-confirm {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: min(clamp(420px, 30vw, 520px), calc(100% - 32px));
		padding: clamp(24px, 1.5vw, 32px);
		border-radius: var(--radius-large);
		background: var(--card-bg);
		box-shadow: 0 16px 40px rgb(0 0 0 / 0.3);
	}

	.post-history-confirm h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.post-history-confirm p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.post-history-confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.post-history-confirm-actions button {
		padding: 0.5rem 1rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.post-history-confirm-actions button.is-primary {
		border-color: transparent;
		background: var(--primary);
		color: var(--primary-foreground);
	}

	.post-history-confirm-actions button.is-danger {
		border-color: transparent;
		background: var(--destructive);
		color: var(--primary-foreground);
	}

	@media (max-width: 768px) {
		.post-editor-title {
			font-size: 1.75rem;
		}
	}
</style>
