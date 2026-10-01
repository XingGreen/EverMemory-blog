<script lang="ts">
import { onDestroy, onMount, setContext } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	extractTocItems,
	POST_EDITOR_CONTEXT,
	type PostEditorFields,
	type PostEditorUiState,
} from "./postEditorContext";
import PostEditorFmPanel from "./PostEditorFmPanel.svelte";
import PostEditorWritePanel from "./PostEditorWritePanel.svelte";
import PostEditorTocPanel from "./PostEditorTocPanel.svelte";

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

/**
 * 三栏共享的唯一状态源：字段与 UI 状态合并为一个 $state 对象，
 * 由容器创建并通过 context 下发，各栏直接双向绑定。
 */
const editorState = $state({
	title: "",
	author: "",
	category: "",
	description: "",
	content: "",
	slug: "",
	published: "",
	updated: "",
	isDraft: false,
	isPinned: false,
	image: "",
	lang: "",
	licenseName: "",
	licenseUrl: "",
	sourceLink: "",
	enableComment: true,
	password: "",
	passwordHint: "",
	tagInput: "",
	tags: [] as string[],
	activeTab: "editor" as "editor" | "preview",
	// 左侧表单分组折叠：仅「必填基础」默认展开，其余收起以减少纵向滚动
	openGroups: {
		essential: true,
		publish: false,
		seo: false,
		advanced: false,
	},
	renderedHtml: `<p class='empty-preview'>${i18n(I18nKey.postPreviewEmpty)}</p>`,
	visibleTocLines: [] as number[],
	editorEl: undefined as HTMLTextAreaElement | undefined,
	previewEl: undefined as HTMLElement | undefined,
} satisfies PostEditorFields & PostEditorUiState);

let isSaving = $state(false);
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

// ── 目录（容器内派生，供滚动与跳转动作使用） ──
const tocItems = $derived(extractTocItems(editorState.content));

// ── 三栏动作 ──
function toggleGroup(group: keyof typeof editorState.openGroups) {
	editorState.openGroups[group] = !editorState.openGroups[group];
}

function handleSlugInput() {
	slugTouched = true;
}

function addTag() {
	const tag = editorState.tagInput.trim();
	if (tag && !editorState.tags.includes(tag)) {
		editorState.tags = [...editorState.tags, tag];
		editorState.tagInput = "";
	}
}

function removeTag(index: number) {
	editorState.tags = editorState.tags.filter((_, i) => i !== index);
}

function handleTagKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === ",") {
		e.preventDefault();
		addTag();
	}
}

function setTab(tab: "editor" | "preview") {
	editorState.activeTab = tab;
}

/** 在选区两侧包裹符号（选区为空时使用占位文本） */
function wrapSelection(before: string, after: string, placeholder: string) {
	const el = editorState.editorEl;
	if (!el) return;
	const start = el.selectionStart;
	const end = el.selectionEnd;
	const selected = editorState.content.slice(start, end) || placeholder;
	editorState.content =
		editorState.content.slice(0, start) +
		before +
		selected +
		after +
		editorState.content.slice(end);
	requestAnimationFrame(() => {
		el.focus();
		const ns = start + before.length;
		el.setSelectionRange(ns, ns + selected.length);
	});
}

/** 在选区所在行(或每行)前加前缀；firstLineOnly 时仅作用于首行（如标题） */
function prependLines(prefix: string, firstLineOnly = false) {
	const el = editorState.editorEl;
	if (!el) return;
	const start = el.selectionStart;
	const end = el.selectionEnd;
	const lineStart = editorState.content.lastIndexOf("\n", start - 1) + 1;
	let selEnd = end;
	if (editorState.content[selEnd] !== "\n") {
		const nl = editorState.content.indexOf("\n", selEnd);
		selEnd = nl === -1 ? editorState.content.length : nl;
	}
	const block = editorState.content.slice(lineStart, selEnd);
	const processed = block
		.split("\n")
		.map((line, i) => (firstLineOnly && i > 0 ? line : prefix + line))
		.join("\n");
	editorState.content =
		editorState.content.slice(0, lineStart) +
		processed +
		"\n" +
		editorState.content.slice(selEnd);
	requestAnimationFrame(() => {
		el.focus();
		el.setSelectionRange(lineStart, lineStart + processed.length);
	});
}

/** 在光标处插入文本 */
function insertAtCursor(text: string) {
	const el = editorState.editorEl;
	if (!el) return;
	const start = el.selectionStart;
	const end = el.selectionEnd;
	editorState.content =
		editorState.content.slice(0, start) + text + editorState.content.slice(end);
	requestAnimationFrame(() => {
		el.focus();
		const pos = start + text.length;
		el.setSelectionRange(pos, pos);
	});
}

function tocTop(item: { lineIndex: number }): number {
	const el = editorState.editorEl;
	if (!el) return 0;
	const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
	return item.lineIndex * lineHeight;
}

function jumpToToc(item: { lineIndex: number; text: string }) {
	if (editorState.activeTab === "preview") {
		const target = [
			...(editorState.previewEl?.querySelectorAll("h1, h2, h3, h4, h5, h6") ??
				[]),
		].find((heading) => {
			const text = (heading.textContent ?? "").replace(/#+$/, "").trim();
			return text === item.text.trim() || text.startsWith(item.text.trim());
		});
		if (target) {
			target.scrollIntoView({ behavior: "smooth", block: "start" });
			editorState.visibleTocLines = [item.lineIndex];
			return;
		}
	}
	if (editorState.activeTab !== "editor") editorState.activeTab = "editor";
	requestAnimationFrame(() => {
		const el = editorState.editorEl;
		if (!el) return;
		el.scrollTop = Math.max(0, tocTop(item) - 8);
		editorState.visibleTocLines = [item.lineIndex];
	});
}

function handleEditorScroll() {
	const el = editorState.editorEl;
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
		editorState.visibleTocLines = visible;
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
	editorState.visibleTocLines = [best];
}

function matchTocLine(heading: Element): number | null {
	const text = (heading.textContent ?? "").replace(/#+$/, "").trim();
	const item = tocItems.find(
		(it) => text === it.text.trim() || text.startsWith(it.text.trim()),
	);
	return item ? item.lineIndex : null;
}

function handlePreviewScroll() {
	const el = editorState.previewEl;
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
		editorState.visibleTocLines = visible;
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
	editorState.visibleTocLines = best === null ? [] : [best];
}

setContext(POST_EDITOR_CONTEXT, {
	state: editorState,
	actions: {
		toggleGroup,
		handleSlugInput,
		addTag,
		removeTag,
		handleTagKeydown,
		setTab,
		insertBold: () => wrapSelection("**", "**", "text"),
		insertItalic: () => wrapSelection("*", "*", "text"),
		insertStrikethrough: () => wrapSelection("~~", "~~", "text"),
		insertH2: () => prependLines("## ", true),
		insertH3: () => prependLines("### ", true),
		insertInlineCode: () => wrapSelection("`", "`", "code"),
		insertCodeBlock: () => wrapSelection("```\n", "\n```", "code"),
		insertLink: () => wrapSelection("[", "](url)", "text"),
		insertImage: () => wrapSelection("![", "](url)", "alt"),
		insertQuote: () => prependLines("> "),
		insertUl: () => prependLines("- "),
		insertOl: () => prependLines("1. "),
		insertDivider: () => insertAtCursor("\n\n---\n\n"),
		handleEditorScroll,
		handlePreviewScroll,
		jumpToToc,
	},
});

$effect(() => {
	editorState.title = post?.title || "";
	editorState.author = post?.author || "";
	editorState.category = post?.category || "";
	editorState.description = post?.description || "";
	editorState.slug = post?.slug || "";
	editorState.published = post?.published
		? formatDate(post.published)
		: new Date().toISOString().split("T")[0];
	editorState.updated = post?.updated ? formatDate(post.updated) : "";
	editorState.isDraft = post?.draft || false;
	editorState.isPinned = post?.pinned || false;
	editorState.image = post?.image || "";
	editorState.lang = post?.lang || "";
	editorState.licenseName = post?.licenseName || "";
	editorState.licenseUrl = post?.licenseUrl || "";
	editorState.sourceLink = post?.sourceLink || "";
	editorState.enableComment = post?.comment !== undefined ? post.comment : true;
	editorState.password = post?.password || "";
	editorState.passwordHint = post?.passwordHint || "";
	editorState.tags = [...(post?.tags || [])];
	isLoadingContent = mode === "edit";
});

$effect(() => {
	// 仅在新建模式、用户未手动编辑过 slug、且 slug 为空时自动生成
	if (
		mode === "create" &&
		!slugTouched &&
		!editorState.slug &&
		editorState.title
	) {
		editorState.slug = generateSlug(editorState.title);
	}
});

/** 是否存在已输入的草稿内容（敏感字段：密码/密码提示不参与备份） */
function hasDraftContent(): boolean {
	return Boolean(
		editorState.title.trim() ||
			editorState.content.trim() ||
			editorState.description.trim() ||
			editorState.category.trim() ||
			editorState.author.trim() ||
			editorState.image.trim() ||
			editorState.sourceLink.trim() ||
			editorState.lang.trim() ||
			editorState.licenseName.trim() ||
			editorState.licenseUrl.trim() ||
			editorState.slug.trim() ||
			editorState.tags.length > 0 ||
			editorState.isPinned,
	);
}

/** 本地持久备份 + 云端自动同步：内容变化后防抖写入 localStorage（400ms）与云端（1200ms，仅新建模式） */
$effect(() => {
	const draft: DraftFields = {
		title: editorState.title,
		author: editorState.author,
		category: editorState.category,
		description: editorState.description,
		content: editorState.content,
		slug: editorState.slug,
		published: editorState.published,
		updated: editorState.updated,
		isDraft: editorState.isDraft,
		isPinned: editorState.isPinned,
		image: editorState.image,
		lang: editorState.lang,
		licenseName: editorState.licenseName,
		licenseUrl: editorState.licenseUrl,
		sourceLink: editorState.sourceLink,
		enableComment: editorState.enableComment,
		tags: editorState.tags,
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
	editorState.title = data.title ?? "";
	editorState.author = data.author ?? "";
	editorState.category = data.category ?? "";
	editorState.description = data.description ?? "";
	editorState.content = data.content ?? "";
	editorState.slug = data.slug ?? "";
	slugTouched = Boolean(data.slug);
	editorState.published =
		data.published ?? new Date().toISOString().split("T")[0];
	editorState.updated = data.updated ?? "";
	editorState.isDraft = Boolean(data.isDraft);
	editorState.isPinned = Boolean(data.isPinned);
	editorState.image = data.image ?? "";
	editorState.lang = data.lang ?? "";
	editorState.licenseName = data.licenseName ?? "";
	editorState.licenseUrl = data.licenseUrl ?? "";
	editorState.sourceLink = data.sourceLink ?? "";
	editorState.enableComment =
		data.enableComment !== undefined ? Boolean(data.enableComment) : true;
	editorState.tags = Array.isArray(data.tags) ? data.tags : [];
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
				editorState.content = data.content;
			} else {
				editorState.content = "";
			}
		} catch {
			editorState.content = "";
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

async function handleSave() {
	if (!editorState.title.trim()) {
		onError(i18n(I18nKey.postTitleRequired));
		return;
	}

	if (!editorState.slug.trim()) {
		onError(i18n(I18nKey.postSlugRequired));
		return;
	}

	isSaving = true;

	try {
		const response = await fetch("/api/admin/save/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug: editorState.slug,
				title: editorState.title,
				author: editorState.author,
				category: editorState.category,
				tags: editorState.tags,
				published: editorState.published,
				updated: editorState.updated,
				description: editorState.description,
				image: editorState.image,
				lang: editorState.lang,
				licenseName: editorState.licenseName,
				licenseUrl: editorState.licenseUrl,
				sourceLink: editorState.sourceLink,
				comment: editorState.enableComment,
				password: editorState.password,
				passwordHint: editorState.passwordHint,
				draft: editorState.isDraft,
				pinned: editorState.isPinned,
				content: editorState.content,
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
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let renderVersion = 0;

async function fetchPreview(mdContent: string) {
	if (!mdContent.trim()) {
		editorState.renderedHtml = `<p class='empty-preview'>${i18n(
			I18nKey.postPreviewEmpty,
		)}</p>`;
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
			editorState.renderedHtml = data.html;
		}
	} catch {
		if (currentVersion === renderVersion) {
			editorState.renderedHtml = `<p class='empty-preview'>${i18n(
				I18nKey.postPreviewFailed,
			)}</p>`;
		}
	}
}

$effect(() => {
	const mdContent = editorState.content;
	if (renderTimer) clearTimeout(renderTimer);
	renderTimer = setTimeout(() => fetchPreview(mdContent), 300);
});

$effect(() => {
	const el = editorState.previewEl;
	const html = editorState.renderedHtml;
	if (!el) return;
	for (const oldScript of [...el.querySelectorAll("script[type='module']")]) {
		const newScript = document.createElement("script");
		newScript.type = "module";
		newScript.textContent = oldScript.textContent ?? "";
		oldScript.replaceWith(newScript);
	}
});

$effect(() => {
	if (tocItems.length && !editorState.visibleTocLines.length) {
		editorState.visibleTocLines = [tocItems[0].lineIndex];
	}
});

$effect(() => {
	const tab = editorState.activeTab;
	if (tab === "preview") handlePreviewScroll();
	else handleEditorScroll();
});
</script>

<div class="editor-shell">
	<header class="editor-header">
		<div class="editor-heading">
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
						<button
							class="cloud-retry"
							onclick={() =>
								saveCloudDraft({
									title: editorState.title,
									author: editorState.author,
									category: editorState.category,
									description: editorState.description,
									content: editorState.content,
									slug: editorState.slug,
									published: editorState.published,
									updated: editorState.updated,
									isDraft: editorState.isDraft,
									isPinned: editorState.isPinned,
									image: editorState.image,
									lang: editorState.lang,
									licenseName: editorState.licenseName,
									licenseUrl: editorState.licenseUrl,
									sourceLink: editorState.sourceLink,
									enableComment: editorState.enableComment,
									tags: editorState.tags,
								})}
						>
							{i18n(I18nKey.cloudDraftRetry)}
						</button>
					{/if}
				</span>
			{/if}
		</div>
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
	</header>

	{#if isLoadingContent}
		<div class="loading-editorState">
			<div class="loader"></div>
			<p>{i18n(I18nKey.postLoadingContent)}</p>
		</div>
	{:else}
		<div
			class="editor-layout"
			style={`--editor-max-page-width: ${editorConfig.maxPageWidth}; --editor-min-content-height: ${editorConfig.minContentHeight}; --editor-default-content-height: ${editorConfig.defaultContentHeight}; --editor-max-content-height: ${editorConfig.maxContentHeight}`}
		>
			<PostEditorFmPanel />
			<PostEditorWritePanel />
			<PostEditorTocPanel />
		</div>
	{/if}
</div>

<style>
	/* 外壳仅承担布局，不提供任何卡片外观：三栏各自是独立卡片 */
	.editor-shell {
		display: grid;
		grid-template-areas:
			"header"
			"layout";
		grid-template-rows: auto 1fr;
		gap: 1.5rem;
	}

	.editor-header {
		grid-area: header;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
	}

	.editor-heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
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

	.loading-editorState {
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

	.loading-editorState p {
		color: var(--content-meta);
	}

	/* 仅负责三栏排布：无背景、无边框、无阴影，栏间透出页面底色 */
	.editor-layout {
		grid-area: layout;
		display: grid;
		grid-template-columns: minmax(280px, 340px) minmax(0, 1fr) 240px;
		gap: 1.5rem;
		align-items: start;
		max-width: var(--editor-max-page-width, 96rem);
		margin-inline: auto;
		width: 100%;
	}

	@media (max-width: 1400px) {
		.editor-layout {
			grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
		}
	}

	@media (max-width: 900px) {
		.editor-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 768px) {
		.editor-header {
			flex-direction: column;
			align-items: stretch;
		}

		.header-actions {
			width: 100%;
		}
	}
</style>