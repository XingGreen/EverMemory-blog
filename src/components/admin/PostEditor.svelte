<script lang="ts">
import { onDestroy, onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let {
	post,
	mode,
	onSave,
	onCancel,
	onError,
}: {
	post: any;
	mode: "edit" | "create";
	onSave: () => void;
	onCancel: () => void;
	onError: (msg: string) => void;
} = $props();

let title = $state("");
let author = $state("");
let category = $state("");
let description = $state("");
let content = $state("");
let slug = $state("");
let published = $state("");
let updated = $state("");
let isDraft = $state(false);
let isPinned = $state(false);
let image = $state("");
let lang = $state("");
let licenseName = $state("");
let licenseUrl = $state("");
let sourceLink = $state("");
let enableComment = $state(true);
let password = $state("");
let passwordHint = $state("");
let tagInput = $state("");
let tags = $state<string[]>([]);
let isSaving = $state(false);
let activeTab = $state<"editor" | "preview">("editor");
let isLoadingContent = $state(false);
// 标记用户是否手动编辑过 slug，防止自动生成覆盖用户输入
let slugTouched = $state(false);
// 新建草稿防丢失：本地持久备份（localStorage，跨会话/关浏览器仍保留）+ 刷新/关闭拦截（beforeunload）
const DRAFT_KEY = "admin-post-draft-create";
let dirty = $state(false);
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
// 云端草稿同步（跨设备）：自动上传到服务端存储（本机文件 / Vercel KV）
type CloudSyncState = "idle" | "syncing" | "saved" | "error";
let cloudSync = $state<CloudSyncState>("idle");
let cloudSavedAt = $state<number | null>(null);
let cloudTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSeq = 0;
let lastCloudKey = "";

$effect(() => {
	title = post?.title || "";
	author = post?.author || "";
	category = post?.category || "";
	description = post?.description || "";
	slug = post?.slug || "";
	published = post?.published
		? formatDate(post.published)
		: new Date().toISOString().split("T")[0];
	updated = post?.updated ? formatDate(post.updated) : "";
	isDraft = post?.draft || false;
	isPinned = post?.pinned || false;
	image = post?.image || "";
	lang = post?.lang || "";
	licenseName = post?.licenseName || "";
	licenseUrl = post?.licenseUrl || "";
	sourceLink = post?.sourceLink || "";
	enableComment = post?.comment !== undefined ? post.comment : true;
	password = post?.password || "";
	passwordHint = post?.passwordHint || "";
	tags = [...(post?.tags || [])];
	isLoadingContent = mode === "edit";
});

function formatDate(dateStr: string): string {
	return new Date(dateStr).toISOString().split("T")[0];
}

function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\u4e00-\u9fa5]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.substring(0, 100);
}

$effect(() => {
	// 仅在新建模式、用户未手动编辑过 slug、且 slug 为空时自动生成
	if (mode === "create" && !slugTouched && !slug && title) {
		slug = generateSlug(title);
	}
});

function handleSlugInput() {
	slugTouched = true;
}

/** 是否存在已输入的草稿内容（敏感字段：密码/密码提示不参与备份） */
function hasDraftContent(): boolean {
	return Boolean(
		title.trim() ||
			content.trim() ||
			description.trim() ||
			category.trim() ||
			author.trim() ||
			image.trim() ||
			sourceLink.trim() ||
			lang.trim() ||
			licenseName.trim() ||
			licenseUrl.trim() ||
			slug.trim() ||
			tags.length > 0 ||
			isPinned,
	);
}

/** 本地持久备份 + 云端自动同步：内容变化后防抖写入 localStorage（400ms）与云端（1200ms，仅新建模式） */
$effect(() => {
	const draft = {
		title,
		author,
		category,
		description,
		content,
		slug,
		published,
		updated,
		isDraft,
		isPinned,
		image,
		lang,
		licenseName,
		licenseUrl,
		sourceLink,
		enableComment,
		tags,
	};
	if (mode !== "create") return;
	if (!hasDraftContent()) return;
	if (draftTimer) clearTimeout(draftTimer);
	draftTimer = setTimeout(() => {
		try {
			localStorage.setItem(
				DRAFT_KEY,
				JSON.stringify({ ...draft, savedAt: Date.now() }),
			);
		} catch {
			// 隐私模式等场景下 localStorage 不可用，忽略即可
		}
	}, 400);
	if (cloudTimer) clearTimeout(cloudTimer);
	cloudTimer = setTimeout(() => {
		void saveCloudDraft(draft);
	}, 1200);
	dirty = true;
});

/** 上传草稿到云端（内容无变化时跳过；敏感字段不上传） */
async function saveCloudDraft(draft: DraftFields) {
	const key = JSON.stringify(draft);
	if (key === lastCloudKey) {
		if (cloudSavedAt) cloudSync = "saved";
		return;
	}
	cloudSync = "syncing";
	const seq = ++cloudSeq;
	try {
		const res = await fetch("/api/admin/draft/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(draft),
		});
		const data = await res.json();
		if (seq !== cloudSeq) return;
		if (res.ok && data.success) {
			lastCloudKey = key;
			cloudSavedAt = data.savedAt ?? null;
			cloudSync = "saved";
		} else {
			cloudSync = "error";
		}
	} catch {
		if (seq === cloudSeq) cloudSync = "error";
	}
}

interface DraftFields {
	title: string;
	author: string;
	category: string;
	description: string;
	content: string;
	slug: string;
	published: string;
	updated: string;
	isDraft: boolean;
	isPinned: boolean;
	image: string;
	lang: string;
	licenseName: string;
	licenseUrl: string;
	sourceLink: string;
	enableComment: boolean;
	tags: string[];
}

interface DraftBlob extends DraftFields {
	savedAt?: number;
}

function applyDraft(data: Partial<DraftBlob>) {
	title = data.title ?? "";
	author = data.author ?? "";
	category = data.category ?? "";
	description = data.description ?? "";
	content = data.content ?? "";
	slug = data.slug ?? "";
	slugTouched = Boolean(data.slug);
	published = data.published ?? new Date().toISOString().split("T")[0];
	updated = data.updated ?? "";
	isDraft = Boolean(data.isDraft);
	isPinned = Boolean(data.isPinned);
	image = data.image ?? "";
	lang = data.lang ?? "";
	licenseName = data.licenseName ?? "";
	licenseUrl = data.licenseUrl ?? "";
	sourceLink = data.sourceLink ?? "";
	enableComment =
		data.enableComment !== undefined ? Boolean(data.enableComment) : true;
	tags = Array.isArray(data.tags) ? data.tags : [];
	dirty = true;
}

/** 重新进入新建页时，恢复草稿：本地 localStorage 与云端各取较新者 */
async function restoreCreateDraft() {
	if (mode !== "create") return;
	let local: DraftBlob | null = null;
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (raw) local = JSON.parse(raw) as DraftBlob;
	} catch {
		// 备份损坏：忽略
	}
	let cloud: DraftBlob | null = null;
	try {
		const res = await fetch("/api/admin/draft/");
		const data = await res.json();
		if (res.ok && data.success && data.draft) {
			cloud = data.draft as DraftBlob;
		}
	} catch {
		// 云端不可达：仅使用本地草稿
	}
	const localTs = local?.savedAt || 0;
	const cloudTs = cloud?.savedAt || 0;
	const source = localTs >= cloudTs ? local : cloud;
	if (!source || (!source.title && !source.content)) return;
	applyDraft(source);
	cloudSavedAt = cloudTs || null;
	if (cloudTs) cloudSync = "saved";
}

/** 有未保存内容时，拦截刷新 / 关闭页面（浏览器原生确认框） */
function registerBeforeUnload() {
	if (typeof window === "undefined") return;
	beforeUnloadHandler = (e: BeforeUnloadEvent) => {
		if (!dirty) return;
		e.preventDefault();
		e.returnValue = "";
	};
	window.addEventListener("beforeunload", beforeUnloadHandler);
}

async function loadContent() {
	if (mode === "edit" && post?.slug) {
		isLoadingContent = true;
		try {
			const response = await fetch(
				`/api/admin/post-content/?slug=${post.slug}`,
			);
			const data = await response.json();
			if (data.success && data.content) {
				content = data.content;
			} else {
				content = "";
			}
		} catch {
			content = "";
		} finally {
			isLoadingContent = false;
		}
	}
}

onMount(() => {
	loadContent();
	registerBeforeUnload();
	void restoreCreateDraft();
});

onDestroy(() => {
	if (draftTimer) clearTimeout(draftTimer);
	if (cloudTimer) clearTimeout(cloudTimer);
	if (beforeUnloadHandler) {
		window.removeEventListener("beforeunload", beforeUnloadHandler);
	}
});

function addTag() {
	const tag = tagInput.trim();
	if (tag && !tags.includes(tag)) {
		tags = [...tags, tag];
		tagInput = "";
	}
}

function removeTag(index: number) {
	tags = tags.filter((_, i) => i !== index);
}

function handleTagKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === ",") {
		e.preventDefault();
		addTag();
	}
}

async function handleSave() {
	if (!title.trim()) {
		onError(i18n(I18nKey.postTitleRequired));
		return;
	}

	if (!slug.trim()) {
		onError(i18n(I18nKey.postSlugRequired));
		return;
	}

	isSaving = true;

	try {
		const response = await fetch("/api/admin/save/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug,
				title,
				author,
				category,
				tags,
				published,
				updated,
				description,
				image,
				lang,
				licenseName,
				licenseUrl,
				sourceLink,
				comment: enableComment,
				password,
				passwordHint,
				draft: isDraft,
				pinned: isPinned,
				content,
			}),
		});

		const data = await response.json();

		if (response.ok && data.success) {
			try {
				localStorage.removeItem(DRAFT_KEY);
			} catch {
				// 忽略清理失败
			}
			// 文章已保存，清除云端草稿
			void fetch("/api/admin/draft/", { method: "DELETE" }).catch(() => {});
			lastCloudKey = "";
			cloudSavedAt = null;
			cloudSync = "idle";
			dirty = false;
			onSave();
		} else {
			console.error("[Editor] 保存失败:", data.message);
			onError(data.message || i18n(I18nKey.postSaveFailed));
		}
	} catch (err) {
		console.error("[Editor] 保存请求异常:", err);
		// TODO i18n
		onError(
			`保存请求失败: ${err instanceof Error ? err.message : String(err)}`,
		);
	} finally {
		isSaving = false;
	}
}

// Markdown 渲染：调用服务端 API，使用与主站相同的渲染管线
let renderedHtml = $state(
	`<p class='empty-preview'>${i18n(I18nKey.postPreviewEmpty)}</p>`,
);
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let renderVersion = 0;

async function fetchPreview(mdContent: string) {
	if (!mdContent.trim()) {
		renderedHtml = `<p class='empty-preview'>${i18n(I18nKey.postPreviewEmpty)}</p>`;
		return;
	}

	const currentVersion = ++renderVersion;
	try {
		const response = await fetch("/api/admin/preview/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: mdContent }),
		});
		const data = await response.json();

		// 防止旧请求覆盖新结果
		if (currentVersion === renderVersion && response.ok && data.success) {
			renderedHtml = data.html;
		}
	} catch {
		if (currentVersion === renderVersion) {
			renderedHtml = `<p class='empty-preview'>${i18n(I18nKey.postPreviewFailed)}</p>`;
		}
	}
}

$effect(() => {
	const mdContent = content;
	if (renderTimer) clearTimeout(renderTimer);
	renderTimer = setTimeout(() => fetchPreview(mdContent), 300);
});

let previewEl: HTMLElement | undefined = $state();

$effect(() => {
	const el = previewEl;
	const html = renderedHtml;
	if (!el) return;
	for (const oldScript of [...el.querySelectorAll("script[type='module']")]) {
		const newScript = document.createElement("script");
		newScript.type = "module";
		newScript.textContent = oldScript.textContent ?? "";
		oldScript.replaceWith(newScript);
	}
});

// ── MD 语法快捷插入 ──
let editorEl: HTMLTextAreaElement | undefined = $state();

/** 在选区两侧包裹符号（选区为空时使用占位文本） */
function wrapSelection(before: string, after: string, placeholder: string) {
	const el = editorEl;
	if (!el) return;
	const start = el.selectionStart;
	const end = el.selectionEnd;
	const selected = content.slice(start, end) || placeholder;
	content =
		content.slice(0, start) + before + selected + after + content.slice(end);
	requestAnimationFrame(() => {
		el.focus();
		const ns = start + before.length;
		el.setSelectionRange(ns, ns + selected.length);
	});
}

/** 在选区所在行(或每行)前加前缀；firstLineOnly 时仅作用于首行（如标题） */
function prependLines(prefix: string, firstLineOnly = false) {
	const el = editorEl;
	if (!el) return;
	const start = el.selectionStart;
	const end = el.selectionEnd;
	const lineStart = content.lastIndexOf("\n", start - 1) + 1;
	let selEnd = end;
	if (content[selEnd] !== "\n") {
		const nl = content.indexOf("\n", selEnd);
		selEnd = nl === -1 ? content.length : nl;
	}
	const block = content.slice(lineStart, selEnd);
	const processed = block
		.split("\n")
		.map((line, i) => (firstLineOnly && i > 0 ? line : prefix + line))
		.join("\n");
	content =
		content.slice(0, lineStart) + processed + "\n" + content.slice(selEnd);
	requestAnimationFrame(() => {
		el.focus();
		el.setSelectionRange(lineStart, lineStart + processed.length);
	});
}

/** 在光标处插入文本 */
function insertAtCursor(text: string) {
	const el = editorEl;
	if (!el) return;
	const start = el.selectionStart;
	const end = el.selectionEnd;
	content = content.slice(0, start) + text + content.slice(end);
	requestAnimationFrame(() => {
		el.focus();
		const pos = start + text.length;
		el.setSelectionRange(pos, pos);
	});
}

const insertBold = () => wrapSelection("**", "**", "text");
const insertItalic = () => wrapSelection("*", "*", "text");
const insertStrikethrough = () => wrapSelection("~~", "~~", "text");
const insertH2 = () => prependLines("## ", true);
const insertH3 = () => prependLines("### ", true);
const insertInlineCode = () => wrapSelection("`", "`", "code");
const insertCodeBlock = () => wrapSelection("```\n", "\n```", "code");
const insertLink = () => wrapSelection("[", "](url)", "text");
const insertImage = () => wrapSelection("![", "](url)", "alt");
const insertQuote = () => prependLines("> ");
const insertUl = () => prependLines("- ");
const insertOl = () => prependLines("1. ");
const insertDivider = () => insertAtCursor("\n\n---\n\n");

// ── 右侧目录 ──
interface TocItem {
	level: number;
	text: string;
	lineIndex: number;
}

const tocItems = $derived<TocItem[]>(
	content.split("\n").reduce<TocItem[]>((acc, line, i) => {
		const m = /^(#{1,6})\s+(.+)$/.exec(line);
		if (m && m[2].trim())
			acc.push({ level: m[1].length, text: m[2].trim(), lineIndex: i });
		return acc;
	}, []),
);

const tocMinDepth = $derived(
	tocItems.length ? Math.min(...tocItems.map((i) => i.level)) : 6,
);

function tocDepthLevel(level: number): number {
	return level === tocMinDepth ? 0 : level === tocMinDepth + 1 ? 1 : 2;
}

let visibleTocLines: number[] = $state([]);

let indicatorTop = $state(0);
let indicatorHeight = $state(0);
let indicatorOpacity = $state(0);
let tocListEl: HTMLElement | undefined = $state();

$effect(() => {
	const lines = visibleTocLines;
	if (!tocListEl) return;
	requestAnimationFrame(() => {
		const list = tocListEl;
		if (!list) return;
		const items = Array.from(
			list.querySelectorAll<HTMLElement>(".toc-item.visible"),
		);
		if (!items.length) {
			indicatorHeight = 0;
			indicatorOpacity = 0;
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const listRect = list.getBoundingClientRect();
		const firstRect = first.getBoundingClientRect();
		const lastRect = last.getBoundingClientRect();
		indicatorTop = firstRect.top - listRect.top;
		indicatorHeight = lastRect.bottom - firstRect.top;
		indicatorOpacity = 1;
	});
});

function tocTop(item: TocItem): number {
	const el = editorEl;
	if (!el) return 0;
	const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
	return item.lineIndex * lineHeight;
}

function jumpToToc(item: TocItem) {
	if (activeTab === "preview") {
		const target = [
			...(previewEl?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? []),
		].find((heading) => {
			const text = (heading.textContent ?? "").replace(/#+$/, "").trim();
			return text === item.text.trim() || text.startsWith(item.text.trim());
		});
		if (target) {
			target.scrollIntoView({ behavior: "smooth", block: "start" });
			visibleTocLines = [item.lineIndex];
			return;
		}
	}
	if (activeTab !== "editor") activeTab = "editor";
	requestAnimationFrame(() => {
		const el = editorEl;
		if (!el) return;
		el.scrollTop = Math.max(0, tocTop(item) - 8);
		visibleTocLines = [item.lineIndex];
	});
}

function handleEditorScroll() {
	const el = editorEl;
	if (!el) return;
	const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
	const top = el.scrollTop;
	const bottom = el.scrollTop + el.clientHeight;
	const visible: number[] = [];
	for (const item of tocItems) {
		const itemTop = item.lineIndex * lineHeight;
		const itemBottom = (item.lineIndex + 1) * lineHeight;
		if (itemTop < bottom && itemBottom > top) visible.push(item.lineIndex);
	}
	if (visible.length) {
		visibleTocLines = visible;
		return;
	}
	if (!tocItems.length) return;
	const mid = top + el.clientHeight / 2;
	let best = tocItems[0].lineIndex;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const item of tocItems) {
		const d = Math.abs(item.lineIndex * lineHeight - mid);
		if (d < bestDist) {
			bestDist = d;
			best = item.lineIndex;
		}
	}
	visibleTocLines = [best];
}

function matchTocLine(heading: Element): number | null {
	const text = (heading.textContent ?? "").replace(/#+$/, "").trim();
	const item = tocItems.find(
		(it) => text === it.text.trim() || text.startsWith(it.text.trim()),
	);
	return item ? item.lineIndex : null;
}

function handlePreviewScroll() {
	const el = previewEl;
	if (!el) return;
	const headings = [...el.querySelectorAll("h1, h2, h3, h4, h5, h6")];
	if (!headings.length) return;
	const elRect = el.getBoundingClientRect();
	const visible: number[] = [];
	for (const h of headings) {
		const rect = h.getBoundingClientRect();
		const relTop = rect.top - elRect.top;
		const relBottom = rect.bottom - elRect.top;
		if (relTop < el.clientHeight && relBottom > 0) {
			const line = matchTocLine(h);
			if (line !== null) visible.push(line);
		}
	}
	if (visible.length) {
		visibleTocLines = visible;
		return;
	}
	let best: number | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const h of headings) {
		const rect = h.getBoundingClientRect();
		const dist = Math.abs(rect.top - elRect.top);
		if (dist < bestDist) {
			bestDist = dist;
			best = matchTocLine(h);
		}
	}
	visibleTocLines = best === null ? [] : [best];
}

$effect(() => {
	if (tocItems.length && !visibleTocLines.length) {
		visibleTocLines = [tocItems[0].lineIndex];
	}
});

$effect(() => {
	const tab = activeTab;
	if (tab === "preview") handlePreviewScroll();
	else handleEditorScroll();
});
</script>

<div class="editor-container">
	<div class="editor-header">
		<h2>{mode === "edit" ? i18n(I18nKey.adminEditPost) : i18n(I18nKey.adminNewPost)}</h2>
		{#if mode === "create" && cloudSync !== "idle"}
			<span
				class="cloud-badge"
				class:error={cloudSync === "error"}
				class:syncing={cloudSync === "syncing"}
			>
				{#if cloudSync === "syncing"}
					<span class="cloud-spinner"></span>
					{i18n(I18nKey.cloudDraftSyncing)}
				{:else if cloudSync === "saved"}
					<Icon icon="material-symbols:cloud-done" class="text-sm" />
					{i18n(I18nKey.cloudDraftSaved)}
					{#if cloudSavedAt}
						{new Date(cloudSavedAt).toLocaleTimeString("zh-CN", {
							hour: "2-digit",
							minute: "2-digit",
						})}
					{/if}
				{:else}
					<Icon icon="material-symbols:cloud-off" class="text-sm" />
					{i18n(I18nKey.cloudDraftFailed)}
					<button class="cloud-retry" onclick={() => saveCloudDraft({
						title,
						author,
						category,
						description,
						content,
						slug,
						published,
						updated,
						isDraft,
						isPinned,
						image,
						lang,
						licenseName,
						licenseUrl,
						sourceLink,
						enableComment,
						tags,
					})}>
						{i18n(I18nKey.cloudDraftRetry)}
					</button>
				{/if}
			</span>
		{/if}
		<div class="header-actions">
			<button class="btn btn-cancel" onclick={onCancel}>
				<Icon icon="material-symbols:arrow-back" class="text-sm" />
				{i18n(I18nKey.postCancel)}
			</button>
			<button class="btn btn-save" onclick={handleSave} disabled={isSaving}>
				{#if isSaving}
					<span class="spinner"></span>
					{i18n(I18nKey.postSaving)}
				{:else}
					<Icon icon="material-symbols:download" class="text-sm" />
					{i18n(I18nKey.postSave)}
				{/if}
			</button>
		</div>
	</div>

	{#if isLoadingContent}
		<div class="loading-state">
			<div class="loader"></div>
			<p>{i18n(I18nKey.postLoadingContent)}</p>
		</div>
	{:else}
		<div
			class="editor-layout"
			style={`--editor-max-page-width: ${editorConfig.maxPageWidth}; --editor-min-content-height: ${editorConfig.minContentHeight}; --editor-default-content-height: ${editorConfig.defaultContentHeight}; --editor-max-content-height: ${editorConfig.maxContentHeight}`}
		>
			<!-- 左侧：Front Matter 元数据 -->
			<aside class="fm-panel">
			<div class="form-section">
					<h3>{i18n(I18nKey.postBasicInfo)}</h3>
					<div class="form-grid">
						<div class="form-group">
							<label>
								{i18n(I18nKey.postTitle)} *
								<input type="text" bind:value={title} placeholder={i18n(I18nKey.postTitlePlaceholder)} class="form-input" />
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postSlug)} *
								<input
									type="text"
									bind:value={slug}
									oninput={handleSlugInput}
									placeholder={i18n(I18nKey.postSlugPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postAuthor)}
								<input type="text" bind:value={author} placeholder={i18n(I18nKey.postAuthorPlaceholder)} class="form-input" />
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postCategory)}
								<input type="text" bind:value={category} placeholder={i18n(I18nKey.postCategoryPlaceholder)} class="form-input" />
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postPubDate)}
								<input type="date" bind:value={published} class="form-input" />
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postUpdateDate)}
								<input type="date" bind:value={updated} class="form-input" />
							</label>
						</div>

						<div class="form-group">
							<label>
								{i18n(I18nKey.postLang)}
								<input type="text" bind:value={lang} placeholder={i18n(I18nKey.postLangPlaceholder)} class="form-input" />
							</label>
						</div>

						<div class="form-group full-width switch-row">
							<label class="md3-switch">
								<input type="checkbox" bind:checked={isDraft} />
								<span class="switch-track">
									<span class="switch-thumb"></span>
								</span>
								<span class="switch-label">{i18n(I18nKey.postDraft)}</span>
							</label>

							<label class="md3-switch">
								<input type="checkbox" bind:checked={isPinned} />
								<span class="switch-track">
									<span class="switch-thumb"></span>
								</span>
								<span class="switch-label">{i18n(I18nKey.postPinned)}</span>
							</label>

							<label class="md3-switch">
								<input type="checkbox" bind:checked={enableComment} />
								<span class="switch-track">
									<span class="switch-thumb"></span>
								</span>
								<span class="switch-label">{i18n(I18nKey.postComments)}</span>
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postCover)}
								<input type="text" bind:value={image} placeholder={i18n(I18nKey.postCoverPlaceholder)} class="form-input" />
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postSummary)}
								<textarea
									bind:value={description}
									placeholder={i18n(I18nKey.postSummaryPlaceholder)}
									class="form-textarea"
									rows={2}
								></textarea>
							</label>
						</div>

						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postTags)}
								<div class="tags-input-wrapper">
									<div class="tags-list">
										{#each tags as tag, i}
											<span class="tag-item">
												{tag}
												<button
													class="tag-remove"
													onclick={() => removeTag(i)}
													aria-label={i18n(I18nKey.postTagRemove)}
												>
													<Icon icon="material-symbols:close" class="text-xs" />
												</button>
											</span>
										{/each}
									</div>
									<input
										type="text"
										bind:value={tagInput}
										placeholder={i18n(I18nKey.postTagPlaceholder)}
										class="form-input tag-input"
										onkeydown={handleTagKeydown}
									/>
								</div>
							</label>
						</div>
					</div>
				</div>

				<!-- 密码保护 -->
				<div class="form-section">
					<h3>{i18n(I18nKey.postPasswordSection)}</h3>
					<div class="form-grid">
						<div class="form-group">
							<label>
								{i18n(I18nKey.postPassword)}
								<input
									type="text"
									bind:value={password}
									placeholder={i18n(I18nKey.postPasswordPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>
						<div class="form-group">
							<label>
								{i18n(I18nKey.postPasswordHint)}
								<input
									type="text"
									bind:value={passwordHint}
									placeholder={i18n(I18nKey.postPasswordHintPlaceholder)}
									class="form-input"
								/>
							</label>
						</div>
					</div>
				</div>

				<!-- 许可证与来源 -->
				<div class="form-section">
					<h3>{i18n(I18nKey.postLicenseSection)}</h3>
					<div class="form-grid">
						<div class="form-group">
							<label>
								{i18n(I18nKey.postLicenseName)}
								<input type="text" bind:value={licenseName} placeholder={i18n(I18nKey.postLicenseNamePlaceholder)} class="form-input" />
							</label>
						</div>
						<div class="form-group">
							<label>
								{i18n(I18nKey.postLicenseUrl)}
								<input type="text" bind:value={licenseUrl} placeholder={i18n(I18nKey.postLicenseUrlPlaceholder)} class="form-input" />
							</label>
						</div>
						<div class="form-group full-width">
							<label>
								{i18n(I18nKey.postSourceLink)}
								<input type="text" bind:value={sourceLink} placeholder={i18n(I18nKey.postSourceLinkPlaceholder)} class="form-input" />
							</label>
						</div>
					</div>
				</div>

			</aside>

			<!-- 中间：书写区 -->
			<section class="write-panel">
				<div class="tabs">
					<button
						class={`tab ${activeTab === "editor" ? "active" : ""}`}
						onclick={() => {
							activeTab = "editor";
						}}
					>
						<Icon icon="material-symbols:ink-pen-outline-rounded" class="text-sm" />
						{i18n(I18nKey.postTabEdit)}
					</button>
					<button
						class={`tab ${activeTab === "preview" ? "active" : ""}`}
						onclick={() => {
							activeTab = "preview";
						}}
					>
						<Icon icon="material-symbols:visibility-outline-rounded" class="text-sm" />
						{i18n(I18nKey.postTabPreview)}
					</button>
				</div>

				<!-- MD 语法快捷键 -->
				<div class="md-toolbar" role="toolbar" aria-label={i18n(I18nKey.postMdToolbar)}>
					<button type="button" title={i18n(I18nKey.postMdBold)} aria-label={i18n(I18nKey.postMdBold)} onclick={insertBold}>
						<Icon icon="material-symbols:format-bold" class="text-sm" />
					</button>
					<button type="button" title={i18n(I18nKey.postMdItalic)} aria-label={i18n(I18nKey.postMdItalic)} onclick={insertItalic}>
						<Icon icon="material-symbols:format-italic" class="text-sm" />
					</button>
					<button type="button" title={i18n(I18nKey.postMdStrikethrough)} aria-label={i18n(I18nKey.postMdStrikethrough)} onclick={insertStrikethrough}>
						<Icon icon="material-symbols:format-strikethrough" class="text-sm" />
					</button>
					<span class="toolbar-sep"></span>
					<button type="button" title={i18n(I18nKey.postMdH2)} aria-label={i18n(I18nKey.postMdH2)} onclick={insertH2}>
						<span class="toolbar-glyph">H2</span>
					</button>
					<button type="button" title={i18n(I18nKey.postMdH3)} aria-label={i18n(I18nKey.postMdH3)} onclick={insertH3}>
						<span class="toolbar-glyph">H3</span>
					</button>
					<span class="toolbar-sep"></span>
					<button type="button" title={i18n(I18nKey.postMdInlineCode)} aria-label={i18n(I18nKey.postMdInlineCode)} onclick={insertInlineCode}>
						<Icon icon="material-symbols:code" class="text-sm" />
					</button>
					<button type="button" title={i18n(I18nKey.postMdCodeBlock)} aria-label={i18n(I18nKey.postMdCodeBlock)} onclick={insertCodeBlock}>
						<Icon icon="material-symbols:data-object" class="text-sm" />
					</button>
					<span class="toolbar-sep"></span>
					<button type="button" title={i18n(I18nKey.postMdLink)} aria-label={i18n(I18nKey.postMdLink)} onclick={insertLink}>
						<Icon icon="material-symbols:link" class="text-sm" />
					</button>
					<button type="button" title={i18n(I18nKey.postMdImage)} aria-label={i18n(I18nKey.postMdImage)} onclick={insertImage}>
						<Icon icon="material-symbols:image" class="text-sm" />
					</button>
					<button type="button" title={i18n(I18nKey.postMdQuote)} aria-label={i18n(I18nKey.postMdQuote)} onclick={insertQuote}>
						<Icon icon="material-symbols:format-quote" class="text-sm" />
					</button>
					<span class="toolbar-sep"></span>
					<button type="button" title={i18n(I18nKey.postMdUl)} aria-label={i18n(I18nKey.postMdUl)} onclick={insertUl}>
						<Icon icon="material-symbols:format-list-bulleted" class="text-sm" />
					</button>
					<button type="button" title={i18n(I18nKey.postMdOl)} aria-label={i18n(I18nKey.postMdOl)} onclick={insertOl}>
						<Icon icon="material-symbols:format-list-numbered" class="text-sm" />
					</button>
					<span class="toolbar-sep"></span>
					<button type="button" title={i18n(I18nKey.postMdDivider)} aria-label={i18n(I18nKey.postMdDivider)} onclick={insertDivider}>
						<Icon icon="material-symbols:horizontal-rule" class="text-sm" />
					</button>
				</div>

				{#if activeTab === "editor"}
					<textarea
						bind:this={editorEl}
						bind:value={content}
						onscroll={handleEditorScroll}
						placeholder={i18n(I18nKey.postContentPlaceholder)}
						class="content-editor"
					></textarea>
				{:else}
					<div
						bind:this={previewEl}
						onscroll={handlePreviewScroll}
						class="prose dark:prose-invert prose-base max-w-none! content-preview custom-md"
					>
						{@html renderedHtml}
					</div>
				{/if}
			</section>

			<!-- 右侧：目录 -->
			<aside class="toc-panel">
				<h3>{i18n(I18nKey.postToc)}</h3>
				{#if tocItems.length > 0}
					<nav class="toc-list" bind:this={tocListEl}>
						{#each tocItems as item, idx}
							<a
								href="#"
								class="toc-item {`toc-level-${tocDepthLevel(item.level)}`}"
								class:visible={visibleTocLines.includes(item.lineIndex)}
								aria-label={item.text}
								title={item.text}
								onclick={(event) => {
									event.preventDefault();
									jumpToToc(item);
								}}
							>
								<div
									class="toc-badge {item.level === tocMinDepth
										? "toc-badge-index"
										: ""}"
								>
									{#if item.level === tocMinDepth}
										{idx + 1}
									{:else if item.level <= tocMinDepth + 1}
										<span class="toc-badge-dot"></span>
									{:else}
										<span class="toc-badge-dot toc-badge-dot-sm"></span>
									{/if}
								</div>
								<div
									class="toc-label {item.level <= tocMinDepth + 1
										? "toc-label-primary"
										: "toc-label-secondary"}"
								>
									{item.text}
								</div>
							</a>
						{/each}
						<div
							class="toc-active-indicator"
							style="top: {indicatorTop}px; height: {indicatorHeight}px; opacity: {indicatorOpacity};"
							aria-hidden="true"
						></div>
					</nav>
				{:else}
					<p class="toc-empty">{i18n(I18nKey.postTocEmpty)}</p>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<style>
	.editor-container {
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		overflow: hidden;
		box-shadow: var(--shadow-card);
	}

	.editor-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.editor-header h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.cloud-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: 0.75rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		color: hsl(130 45% 30%);
		background: hsl(120 45% 92%);
		border: 1px solid hsl(120 40% 78%);
	}

	.cloud-badge.syncing {
		color: hsl(220 30% 40%);
		background: hsl(220 40% 94%);
		border-color: hsl(220 30% 80%);
	}

	.cloud-badge.error {
		color: hsl(0 65% 45%);
		background: hsl(0 60% 95%);
		border-color: hsl(0 55% 82%);
	}

	.cloud-spinner {
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid hsl(220 30% 75%);
		border-top-color: hsl(220 30% 40%);
		border-radius: 50%;
		animation: cloud-spin 0.8s linear infinite;
	}

	@keyframes cloud-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.cloud-retry {
		border: none;
		background: none;
		padding: 0;
		margin: 0;
		font-size: inherit;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.header-actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.btn-cancel {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	.btn-cancel:hover {
		background: var(--btn-regular-bg-hover);
	}

	.btn-save {
		background: var(--primary);
		color: var(--primary-foreground);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-button);
	}

	.btn-save:hover:not(:disabled) {
		filter: brightness(1.05);
		transform: translateY(-1px);
	}

	.btn-save:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-state {
		text-align: center;
		padding: 3rem;
	}

	.loader {
		width: 40px;
		height: 40px;
		border: 3px solid var(--line-divider);
		border-top-color: var(--primary);
		border-radius: 50%;
		margin: 0 auto 1rem;
		animation: spin 0.8s linear infinite;
	}

	.loading-state p {
		color: var(--content-meta);
	}

	.editor-layout {
		display: grid;
		grid-template-columns: minmax(280px, 340px) minmax(0, 1fr) 240px;
		gap: 1.5rem;
		padding: 1.75rem;
		align-items: start;
		max-width: var(--editor-max-page-width, 96rem);
		margin-inline: auto;
		width: 100%;
	}

	/* ── 左侧：Front Matter 面板 ── */
	.fm-panel {
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 7.5rem);
		overflow-y: auto;
		padding: 1.5rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.fm-panel .form-section {
		gap: 1rem;
	}

	.fm-panel .form-section h3 {
		font-size: 0.9375rem;
		padding-bottom: 0.75rem;
	}

	.fm-panel .form-grid {
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.fm-panel .switch-row {
		padding: 0;
		gap: 1rem;
	}

	.fm-panel .form-input,
	.fm-panel .form-textarea {
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		background: var(--btn-regular-bg);
	}

	/* ── 中间：书写区 ── */
	.write-panel {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
	}

	.md-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.5rem;
		background: var(--btn-regular-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
	}

	.md-toolbar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--content-meta);
		cursor: pointer;
		font-family: inherit;
		transition: background 0.15s, color 0.15s;
	}

	.md-toolbar button:hover {
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		color: var(--primary);
	}

	.toolbar-glyph {
		font-size: 0.6875rem;
		font-weight: 700;
	}

	.toolbar-sep {
		width: 1px;
		height: 1.25rem;
		background: var(--line-divider);
		margin: 0 0.375rem;
	}

	.write-panel .content-editor,
	.write-panel > .content-preview {
		min-height: var(--editor-min-content-height, 26rem);
		height: var(--editor-default-content-height, calc(100vh - 18rem));
		max-height: var(--editor-max-content-height, calc(100vh - 10rem));
	}

	/* ── 右侧：目录 ── */
	.toc-panel {
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 7.5rem);
		overflow-y: auto;
		padding: 1.5rem 1.25rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
	}

	.toc-panel h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
		padding-bottom: 0.5rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.toc-list {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
	}

	.toc-panel .toc-list .toc-item {
		position: relative;
		z-index: 1;
	}

.toc-panel .toc-list .toc-active-indicator {
		z-index: 0;
		background: color-mix(in oklab, var(--primary) 12%, var(--btn-regular-bg));
	}

	.toc-panel .toc-list .toc-badge-index {
		background: color-mix(in oklab, var(--primary) 16%, var(--btn-regular-bg));
		color: color-mix(in oklab, var(--primary) 75%, var(--deep-text));
	}

	.toc-empty {
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--content-meta);
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.form-section h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group > label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.form-input,
	.form-textarea,
	.content-editor {
		padding: 0.625rem 0.875rem;
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: inherit;
		transition: border-color 0.15s;
		background: var(--card-bg);
		color: var(--deep-text);
	}

	.form-input:focus,
	.form-textarea:focus,
	.content-editor:focus {
		outline: none;
		border-color: var(--primary);
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	.checkbox-group {
		justify-content: flex-end;
	}

	.full-width {
		grid-column: 1 / -1;
	}

	/* ── MD3 Switch 行 ── */
	.switch-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 1.5rem;
		padding: 0.25rem 0;
	}

	/* ── MD3 Switch ── */
	.md3-switch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--deep-text);
		position: relative;
		user-select: none;
	}

	.md3-switch input {
		position: absolute;
		opacity: 0;
		width: 48px;
		height: 48px;
		margin: 0;
		cursor: pointer;
		z-index: 2;
	}

	.switch-track {
		width: 32px;
		height: 18px;
		border-radius: 10px;
		border: 2px solid var(--content-meta);
		background: transparent;
		position: relative;
		transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
		flex-shrink: 0;
	}

	.switch-thumb {
		position: absolute;
		top: 50%;
		left: 4px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--content-meta);
		transform: translateY(-50%);
		transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
	}

	.md3-switch:hover .switch-track {
		border-color: var(--primary);
	}

	.md3-switch input:checked ~ .switch-track {
		background: var(--primary);
		border-color: var(--primary);
	}

	.md3-switch input:checked ~ .switch-track .switch-thumb {
		left: 18px;
		width: 12px;
		height: 12px;
		background: white;
	}

	.switch-label {
		line-height: 1;
	}

	.tags-input-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		min-height: 32px;
	}

	.tag-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		border-radius: var(--radius-full);
		font-size: 0.8rem;
		color: var(--primary);
	}

	.tag-remove {
		border: none;
		background: none;
		color: var(--content-meta);
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tag-remove:hover {
		color: #ef4444;
	}

	.tag-input {
		flex: 1;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.tab {
		padding: 0.625rem 1rem;
		border: none;
		background: none;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--content-meta);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tab.active {
		color: var(--primary);
		border-bottom-color: var(--primary);
	}

	.content-editor {
		min-height: 400px;
		font-family: "Monaco", "Consolas", monospace;
		font-size: 0.875rem;
		line-height: 1.6;
		resize: vertical;
	}

	.content-preview {
		min-height: 400px;
		padding: 1.25rem;
		overflow-y: auto;
	}

	/* 代码块排版：对齐前台 expressive-code（one-light / one-dark）观感，
	   并阻断 markdown.css 的 .custom-md code 内联码背景渗入 pre code */
	:global(.content-preview pre) {
		border-radius: var(--radius-md);
		overflow-x: auto;
		background: oklch(0.985 0.002 275);
		color: #383a42;
	}
	:global(.content-preview pre code) {
		background: transparent;
		color: inherit;
		padding: 0;
	}
	:global(.dark .content-preview pre) {
		background: oklch(0.205 0.015 275);
		color: #abb2bf;
	}

	.content-preview :global(.empty-preview) {
		color: var(--content-meta);
		text-align: center;
		padding: 2rem;
	}

	@media (max-width: 1400px) {
		.editor-layout {
			grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
		}

		.toc-panel {
			display: none;
		}
	}

	@media (max-width: 900px) {
		.editor-layout {
			grid-template-columns: 1fr;
		}

		.fm-panel,
		.toc-panel {
			position: static;
			max-height: none;
		}

		.toc-panel {
			display: block;
		}

		.write-panel .content-editor,
		.write-panel > .content-preview {
			height: 60vh;
		}
	}

	@media (max-width: 768px) {
		.editor-header {
			flex-direction: column;
			gap: 1rem;
		}

		.header-actions {
			width: 100%;
		}

		.form-grid {
			grid-template-columns: 1fr;
		}
	}
</style>