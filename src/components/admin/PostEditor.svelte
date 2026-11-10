<script lang="ts">
import { onDestroy, onMount, setContext } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { fade, fly } from "svelte/transition";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import { siteConfig } from "@/config/siteConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AdminWriteResponse } from "@/types/adminApi";
import {
	findTitleConflict,
	invalidatePostTitles,
	loadPostTitles,
} from "@/utils/admin-post-titles";
import { buildEncryptedTitle } from "@/utils/encrypted-title";
import { countWords } from "@/utils/reading-stats";
import DraftConflictDialog from "./DraftConflictDialog.svelte";
import PostEditorFmPanel from "./PostEditorFmPanel.svelte";
import PostEditorTocPanel from "./PostEditorTocPanel.svelte";
import PostEditorWritePanel from "./PostEditorWritePanel.svelte";
import {
	extractTocItems,
	POST_EDITOR_CONTEXT,
	type PostEditorFields,
	type PostEditorUiState,
} from "./postEditorContext";

let {
	post,
	mode,
	onSave,
	onCancel,
	onError,
	onDelete,
}: {
	post: any;
	mode: "edit" | "create";
	/** 传参时展示后端返回的文案，用于区分「仅本地保存」与「已同步」 */
	onSave: (message?: string) => void;
	onCancel: () => void;
	onError: (msg: string) => void;
	/** 删除只在这里出现：个人博客删文章是罕见动作，不值得每行占一格 */
	onDelete?: (trigger?: HTMLElement | null) => void;
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
	canUndo: false,
	canRedo: false,
	/* 行号默认关闭：多数写作场景不需要，开启后正文左侧多出 3rem 的 gutter */
	showLineNumbers: readShowLineNumbers(),
	slugVerified: false,
} satisfies PostEditorFields & PostEditorUiState);

// 右侧抽屉：基本信息（元数据）与目录共用；单栏写作不再常驻左右两栏
type Drawer = "none" | "info" | "toc";
let drawer = $state<Drawer>("none");

function toggleDrawer(panel: Exclude<Drawer, "none">) {
	drawer = drawer === panel ? "none" : panel;
}

/** 抽屉焦点管理（参考 post-editor-info-panel）：打开时聚焦关闭钮，关闭时还原到触发元素 */
let drawerCloseEl: HTMLButtonElement | undefined = $state();
let drawerOpener: HTMLElement | null = null;

function handleDrawerKeydown(e: KeyboardEvent) {
	if (e.key !== "Escape") return;
	e.stopPropagation();
	drawer = "none";
}

$effect(() => {
	if (drawer === "none") {
		drawerOpener?.focus();
		drawerOpener = null;
		return;
	}
	drawerOpener = document.activeElement as HTMLElement | null;
	requestAnimationFrame(() => drawerCloseEl?.focus());
});

let isSaving = $state(false);

/**
 * 书写区撤销/重做：维护 content 的全文快照栈。
 * 输入停止 400ms 后落一个记录点（合并连续击键）；文章加载 / 草稿恢复 / 工具插入
 * 各自形成独立记录点。上限 200 步，超出丢弃最旧的记录。
 */
const HISTORY_LIMIT = 200;
let history = $state<string[]>([]);
let historyIndex = $state(-1);
let historyTimer: ReturnType<typeof setTimeout> | undefined;
let historyApplying = false;
let historyInitialized = false;

function recordHistoryPoint() {
	const value = editorState.content;
	if (history[historyIndex] === value) return;
	history = [...history.slice(0, historyIndex + 1), value];
	if (history.length > HISTORY_LIMIT) {
		history = history.slice(history.length - HISTORY_LIMIT);
	}
	historyIndex = history.length - 1;
}

/** 以当前内容重置历史（文章 / 草稿载入后调用），使撤销不会越过载入点 */
function resetHistory() {
	history = [editorState.content];
	historyIndex = 0;
}

function undoEditor() {
	if (historyIndex <= 0) return;
	historyApplying = true;
	historyIndex -= 1;
	editorState.content = history[historyIndex];
	placeCaretAtEnd();
}

function redoEditor() {
	if (historyIndex >= history.length - 1) return;
	historyApplying = true;
	historyIndex += 1;
	editorState.content = history[historyIndex];
	placeCaretAtEnd();
}

/** 历史回退后把光标放到末尾：原生撤销会还原光标，快照方案无法映射，退而求其次 */
function placeCaretAtEnd() {
	const el = editorState.editorEl;
	if (!el) return;
	requestAnimationFrame(() => {
		el.focus();
		const end = el.value.length;
		el.setSelectionRange(end, end);
	});
}

// content 变化即安排记录点；撤销/重做自身引起的变化不再记录
$effect(() => {
	const value = editorState.content;
	if (historyApplying) {
		historyApplying = false;
		return;
	}
	if (!historyInitialized) {
		historyInitialized = true;
		recordHistoryPoint();
		return;
	}
	if (historyTimer) clearTimeout(historyTimer);
	historyTimer = setTimeout(recordHistoryPoint, 400);
	return () => {
		if (historyTimer) clearTimeout(historyTimer);
	};
});

// 历史指针 / 栈变化 → 同步按钮可用态
$effect(() => {
	editorState.canUndo = historyIndex > 0;
	editorState.canRedo = historyIndex < history.length - 1;
});
let isLoadingContent = $state(false);
// 标记用户是否手动编辑过 slug，防止自动生成覆盖用户输入
let slugTouched = $state(false);

/* ── 行号显示（配置项）──
   键与草稿分开存：行号是编辑器偏好，同一篇文章的新建/编辑应共用。 */
const LINE_NUMBERS_KEY = "admin-editor-line-numbers";

function readShowLineNumbers(): boolean {
	try {
		return localStorage.getItem(LINE_NUMBERS_KEY) === "1";
	} catch {
		// SSR 或隐私模式：默认关闭
		return false;
	}
}

function toggleLineNumbers() {
	editorState.showLineNumbers = !editorState.showLineNumbers;
	try {
		localStorage.setItem(
			LINE_NUMBERS_KEY,
			editorState.showLineNumbers ? "1" : "0",
		);
	} catch {
		// 持久化失败不影响本次会话
	}
}

/* ── 拖拽调整编辑区宽度 ──
   交互参考 VSCode 侧栏拖拽：按下手柄后跟随指针移动，松手落盘。
   左右两侧各一条手柄，向内拖都是"变窄"，因此位移按 ±dx*2 计算（对称收缩）。
   宽度即 .editor-layout 的 max-width，下限 720px 保证正文不至于挤成一列。 */
const EDITOR_WIDTH_KEY = "admin-editor-max-width";
/* 正文最小宽度：到达该值后拖拽不再继续缩小，避免排版被挤压崩坏 */
const EDITOR_WIDTH_MIN = 400;

function readEditorWidth(): number | null {
	try {
		const raw = Number(localStorage.getItem(EDITOR_WIDTH_KEY));
		if (Number.isFinite(raw) && raw >= EDITOR_WIDTH_MIN) return raw;
	} catch {
		// SSR / 隐私模式：用配置默认值
	}
	// null 表示「未拖拽过」，继续沿用 editorConfig.maxPageWidth
	return null;
}

let editorMaxWidth = $state<number | null>(readEditorWidth());
let resizing = $state(false);

function startResize(e: PointerEvent, side: "left" | "right") {
	e.preventDefault();
	resizing = true;
	const startX = e.clientX;
	const startW =
		editorMaxWidth ??
		(typeof window === "undefined" ? 1440 : window.innerWidth);
	const viewport = typeof window === "undefined" ? 1920 : window.innerWidth;

	const onMove = (ev: PointerEvent) => {
		/* delta > 0 表示向内收（右侧手柄左移 / 左侧手柄右移）→ 宽度要变小；
		   delta < 0 表示向外放 → 变宽。上一版写成 startW + delta*2，
		   「向内拖」反而在加宽，随即被 Math.min(viewport) 夹回原值，
		   所以表现为「只有 hover 效果、拖动无反应」。 */
		const delta = side === "right" ? startX - ev.clientX : ev.clientX - startX;
		const next = startW - delta * 2;
		/* 先按视口收敛，再兜底最小宽度——顺序反了的话，窗口比 400 窄时仍会突破下限 */
		editorMaxWidth = Math.max(EDITOR_WIDTH_MIN, Math.min(viewport, next));
	};
	const onUp = () => {
		resizing = false;
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		try {
			localStorage.setItem(EDITOR_WIDTH_KEY, String(editorMaxWidth));
		} catch {
			// 忽略
		}
	};
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
}

// 草稿防丢失：本地持久备份（localStorage，跨会话/关浏览器仍保留）+ 刷新/关闭拦截（beforeunload）
// 编辑页也启用，键按 slug 区分——否则编辑 A 文章的草稿会覆盖 B 文章的。
const DRAFT_KEY = $derived(
	mode === "create"
		? "admin-post-draft-create"
		: `admin-post-draft-edit-${post?.slug ?? "unknown"}`,
);
let dirty = $state(false);
/** 最近一次草稿写入本地的时间：顶栏徽章据此显示「草稿保存于 12:03」 */
let lastDraftSavedAt = $state<number | null>(null);
/**
 * 恢复草稿后的顶部横幅。草稿套用进编辑区后，编辑器里看到的内容与云端正文
 * 已经不是一回事，不做标记的话用户会误以为自己看的就是已保存的正文。
 */
let draftBanner = $state<{
	ago: string;
	device: string;
	fromCloud: boolean;
} | null>(null);
/** 用户已确认恢复的那份草稿的内容指纹；内容未再变化时继续带 restored 标记 */
let restoredDraftKey: string | null = null;
/** 本次进入后是否成功保存过（新建模式下用来区分「新建未保存」与「已保存」） */
let savedOnce = $state(false);

/**
 * 顶栏状态徽章三态：
 *   saved  编辑区里的内容就是已保存的正文
 *   dirty  有未保存改动，只存在草稿里（本地/云端），还没写进正文
 *   fresh  新建文章，一次都还没保存过
 * 草稿自动保存能防止丢内容，但也会让人误以为「已经存好了」，
 * 所以状态必须在顶栏可见，而不是只藏在右上角的同步徽章里。
 */
type DocState = "saved" | "dirty" | "fresh";
const docState = $derived<DocState>(
	dirty ? "dirty" : mode === "create" && !savedOnce ? "fresh" : "saved",
);
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
// 云端草稿同步（跨设备）：自动上传到服务端存储（本机文件 / Vercel KV）
/**
 * 同步状态五态 —— 表示「此刻」的真实状况，而不是「上次成功过」：
 *   idle       尚未发生任何保存
 *   local-only 已写入本地草稿，但云端没有（离线、未发起、或从未成功）
 *   syncing    请求进行中
 *   synced     云端请求成功，且当前内容与云端一致
 *   failed     请求失败或设备离线
 * 旧实现只有 idle/syncing/saved/error 四态，缺「仅本地」；
 * 且内容未变跳过请求时会直接把状态写成 saved，离线也照写，因此误报「已同步」。
 */
type CloudSyncState = "idle" | "local-only" | "syncing" | "synced" | "failed";
let cloudSync = $state<CloudSyncState>("idle");
let cloudSavedAt = $state<number | null>(null);
/** 设备在线状态：离线时不发请求，直接判 failed 并等 online 事件重试 */
let isOnline = $state(
	typeof navigator === "undefined" ? true : navigator.onLine,
);
let cloudTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSeq = 0;
let lastCloudKey = "";
/* 在飞的草稿保存请求（参考的 inFlightRef）：用于挡并发，也供 flush 等待 */
let cloudInFlight: Promise<void> | null = null;

function formatDate(dateStr: string): string {
	return new Date(dateStr).toISOString().split("T")[0];
}

/**
 * 由标题生成 URL 标识：先中文转拼音，再走 slugify。
 * 后端 isValidPostSlug 只接受 ASCII，故不保留汉字。
 * pinyin-pro 体积较大，动态 import 只在需要时加载。
 */
async function generateSlug(title: string): Promise<string> {
	const { pinyin } = await import("pinyin-pro");
	const romanized = pinyin(title, {
		toneType: "none",
		nonZh: "consecutive",
	});
	const cleaned = romanized
		.toLowerCase()
		// 拼音的 ü 归一为 v，避免后续被剔除（如「绿色」→ lü → lv）
		.replace(/ü/g, "v")
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]+/g, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.substring(0, 100);
	return cleaned || "untitled-post";
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

/** 刷新按钮的一次性成功反馈时长 */
const SLUG_VERIFIED_MS = 1500;
let slugVerifiedTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * slug 生成后再对照标题复核一次：由当前标题重新推导一次，
 * 与已写入的 slug 一致（且非空）才算生成成功，给按钮一次 √ 反馈。
 * 复核期间标题被改动会推导出不同结果，此时不显示成功。
 */
async function verifySlugAgainstTitle(): Promise<void> {
	const check = await generateSlug(editorState.title);
	if (check === "" || check !== editorState.slug) return;
	editorState.slugVerified = true;
	if (slugVerifiedTimer) clearTimeout(slugVerifiedTimer);
	slugVerifiedTimer = setTimeout(() => {
		editorState.slugVerified = false;
	}, SLUG_VERIFIED_MS);
}

/** 手动触发：按当前标题重新生成 slug（与自动生成同源），之后固定不再被覆盖 */
function generateSlugFromTitle() {
	void generateSlug(editorState.title).then((value) => {
		editorState.slug = value;
		slugTouched = true;
		void verifySlugAgainstTitle();
	});
}

$effect(() => () => {
	if (slugVerifiedTimer) clearTimeout(slugVerifiedTimer);
});

/** slug 输入框失焦：含非 ASCII 字符（如中文）时就地转拼音规范化，避免后端 400 */
function normalizeSlug() {
	if (!editorState.slug || /^[A-Za-z0-9_-]+$/.test(editorState.slug)) return;
	void generateSlug(editorState.slug).then((value) => {
		editorState.slug = value;
	});
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

// 目录跳转后标题与容器顶部保留的留白，编辑态与预览态共用
const TOC_SCROLL_HEADROOM = 8;

function jumpToToc(item: { lineIndex: number; text: string }) {
	if (editorState.activeTab === "preview") {
		const target = [
			...(editorState.previewEl?.querySelectorAll("h1, h2, h3, h4, h5, h6") ??
				[]),
		].find((heading) => {
			const text = (heading.textContent ?? "").replace(/#+$/, "").trim();
			return text === item.text.trim() || text.startsWith(item.text.trim());
		});
		const container = editorState.previewEl;
		if (target && container) {
			// 只能滚动预览容器自身，不能用 scrollIntoView：
			// 它会连带滚动所有可滚动祖先，而后台整页被锁
			// (AdminLayout 里 html/body 为 overflow:hidden)，
			// 文档层一旦被程序化滚动就再也滚不回去，
			// 表现为页面上部被推走、下部被截断且无法恢复。
			const offset =
				target.getBoundingClientRect().top -
				container.getBoundingClientRect().top +
				container.scrollTop -
				TOC_SCROLL_HEADROOM;
			container.scrollTo({
				top: Math.max(0, offset),
				behavior: "smooth",
			});
			editorState.visibleTocLines = [item.lineIndex];
			return;
		}
	}
	if (editorState.activeTab !== "editor") editorState.activeTab = "editor";
	requestAnimationFrame(() => {
		const el = editorState.editorEl;
		if (!el) return;
		el.scrollTop = Math.max(0, tocTop(item) - TOC_SCROLL_HEADROOM);
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
		toggleLineNumbers,
		markDirty: () => {
			dirty = true;
		},
		handleSlugInput,
		generateSlugFromTitle,
		normalizeSlug,
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
		undo: undoEditor,
		redo: redoEditor,
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
		void generateSlug(editorState.title).then((value) => {
			// 异步返回后再次确认，避免覆盖用户手动输入
			if (slugTouched || editorState.slug) return;
			editorState.slug = value;
			// 生成后再对照标题复核一次，通过则给刷新按钮一次成功反馈
			void verifySlugAgainstTitle();
		});
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
/** 加载完成时的内容基线：与它一致说明用户尚未改动，不触发草稿写入 */
let baselineDraftKey = "";

/** 当前编辑器内容的草稿快照：effect 与「保存后再检脏」共用，避免两处手抄字段 */
function currentDraft(): DraftFields {
	return {
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
		device: describeDevice(),
	};
}

/**
 * 把草稿落到本地 localStorage，返回是否写入成功。
 * 云端同步失败时会直接调用它，确保「失败」不等于「数据丢了」。
 * 注意：写入本身不改状态，由调用方决定展示 local-only 还是 failed。
 */
function persistLocalDraft(draft: DraftFields, restored = false): boolean {
	/* slug 还没加载完时不写：此时键会退化成 ...-unknown，等文章到位后
	   读写都换成 ...-<slug>，先前写进去的那份再也读不回来，表现为「退出再进全丢」。
	   自动保存可能在正文加载前就触发，这条早退是主要防线。 */
	if (mode === "edit" && !post?.slug) return false;
	/* 本次会话一旦恢复过草稿，后续写入都保留 restored 标记：
	   用户已经做过「用这份草稿」的决定，继续编辑不改变这个决定，
	   否则每次退出再进来都会重问一遍「草稿与正文用哪个」。
	   恢复后 400ms 的自动保存也会再写一次，不带着标记就会把标记抹掉。 */
	const keepRestored = restored || restoredDraftKey !== null;
	try {
		const contentKey = JSON.stringify(draft);
		/* 时间戳表示「这份内容是什么时候写的」，不是「最后一次写盘是什么时候」。
		   自动保存每隔几百毫秒就会写一次，若无条件刷新 savedAt，
		   几周前的旧草稿会被刷成刚刚，随后又按「近期」静默套用。 */
		let prevSavedAt = 0;
		let prevKey: string | undefined;
		try {
			const prev = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "");
			prevSavedAt = typeof prev?.savedAt === "number" ? prev.savedAt : 0;
			prevKey =
				typeof prev?.contentKey === "string" ? prev.contentKey : undefined;
		} catch {
			// 没有旧草稿或已损坏：按首次写入处理
		}
		const savedAt =
			prevKey === contentKey && prevSavedAt > 0 ? prevSavedAt : Date.now();

		localStorage.setItem(
			DRAFT_KEY,
			JSON.stringify({
				...draft,
				...(keepRestored ? { restored: true } : {}),
				contentKey,
				savedAt,
			}),
		);
		/* 顶栏徽章要显示「草稿保存于 12:03」：这里记的是内容真正变化的时间，
		   不是每次写盘的时刻，所以内容没变时它不会乱跳 */
		lastDraftSavedAt = savedAt;
		return true;
	} catch {
		// 隐私模式 / 配额不足：写不进去，由调用方按「未保存」处理
		return false;
	}
}

/**
 * 当前浏览器与系统，形如「Chrome · Windows」「Safari · iOS」。
 *
 * 只取这两项：用户认的是「我在手机上写的」还是「在电脑上写的」，
 * 完整的 UA 字符串对判断没有帮助，反而更难读。
 */
function describeDevice(): string {
	if (typeof navigator === "undefined") return "未知设备";
	const ua = navigator.userAgent;

	const browser = /Edg\//.test(ua)
		? "Edge"
		: /OPR\//.test(ua)
			? "Opera"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /Chrome\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: "浏览器";

	/* iPadOS 13+ 的 UA 伪装成 macOS，靠触摸点数区分 */
	const isIPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
	const os =
		/iPhone|iPad|iPod/.test(ua) || isIPad
			? "iOS"
			: /Android/.test(ua)
				? "Android"
				: /Mac OS X/.test(ua)
					? "macOS"
					: /Windows/.test(ua)
						? "Windows"
						: /Linux/.test(ua)
							? "Linux"
							: "未知系统";

	return `${browser} · ${os}`;
}

/**
 * 把时间戳说成人话。
 * 「2026/11/4 19:20:00」要读两遍才知道是多久以前，「19 分钟前」一眼就懂——
 * 这个数字直接决定用户敢不敢恢复。
 */
function humanAgo(ts: number): string {
	const minutes = Math.floor((Date.now() - ts) / 60000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} 天前`;
	return new Date(ts).toLocaleDateString();
}

/**
 * 按草稿内容里记录的 slug 反查槽位。
 *
 * 场景：在 A 文章的编辑页把 slug 改成 B（B 文件已存在），草稿仍写在 A 的槽里，
 * 但内容里 slug 记的是 B。之后从 /edit/B/ 进来，按 B 的槽查是空的。
 * 遍历一遍所有编辑槽即可命中——槽位数是「同时编辑过的文章数」，几十个以内。
 */
function findDraftBySlug(
	slug: string,
): { key: string; blob: DraftBlob } | null {
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key?.startsWith("admin-post-draft-edit-")) continue;
		try {
			const blob = JSON.parse(localStorage.getItem(key) ?? "") as DraftBlob;
			if (blob?.slug === slug) return { key, blob };
		} catch {
			// 单条损坏不影响其它槽
		}
	}
	return null;
}

$effect(() => {
	/* 正文还在加载时一律不产生草稿：编辑页的 content 会从空被填满，
	   否则会先把「空内容」存一次（日志里的「字符数 0」就是这么来的）。 */
	if (isLoadingContent) return;
	const draft: DraftFields = currentDraft();
	// 草稿自动保存对新建与编辑都生效：编辑页同样会因误关标签页丢改动。
	// 去抖时长对齐参考 use-auto-save.ts 的 debounceMs 默认值 1500ms。
	if (!hasDraftContent()) {
		/* 内容被清空也算改动：此时没有可写进草稿的字段，但绝不能因此显示「已保存」。
		   空表单 + 有基线 = 用户把原来有的东西删掉了。 */
		if (baselineDraftKey) dirty = true;
		return;
	}
	/* 与加载时的基线一致 → 用户还没改过，不写草稿。
	   否则编辑页一进来就会因「正文从空变有值」触发一次保存并显示「仅本地」。 */
	if (JSON.stringify(draft) === baselineDraftKey) return;
	/* 走到这里说明内容确实变了：状态徽章立刻转为「草稿 · 未保存」，
	   不必等 400ms 后的写盘完成——用户改动后第一眼就该看到这个提示 */
	dirty = true;
	if (draftTimer) clearTimeout(draftTimer);
	draftTimer = setTimeout(() => {
		const saved = persistLocalDraft(draft);
		/* 本地已落地 → 内容变了，云端此刻一定还没有这份新内容，
		   所以状态必须降为「仅本地」，等云端请求成功后才回到「已同步」。
		   旧实现排除了 synced，导致「已同步过」被当成「当前内容已同步」——
		   用户继续编辑后界面仍显示已同步，而实际上云端还是旧内容（假阳性来源）。
		   只在 syncing 时不覆盖：那次请求回来会自行决定最终状态。 */
		if (saved && cloudSync !== "syncing") {
			cloudSync = "local-only";
		}
	}, 400);
	if (cloudTimer) clearTimeout(cloudTimer);
	cloudTimer = setTimeout(() => {
		void saveCloudDraft(draft);
	}, 1500);
});

/** 上传草稿到云端（内容无变化时跳过；敏感字段不上传） */
async function saveCloudDraft(draft: DraftFields) {
	const key = JSON.stringify(draft);
	/* 内容与上次成功上传的一致：不重发，也不改写状态。
	   旧实现这里会写 "saved"，导致离线时仍显示「已同步」——误报的直接来源。 */
	if (key === lastCloudKey) return;
	/* 已有请求在飞：先等它落定；若那次保存的内容已覆盖当前状态就不必重发，
	   同样不改写状态（避免把「上次成功」误当成「此刻已同步」）。 */
	if (cloudInFlight) {
		await cloudInFlight;
		if (JSON.stringify(currentDraft()) === lastCloudKey) return;
	}

	/* 离线：不发请求。先确保内容已落到本地，再标失败——
	   文案会明确告知「已保存至本地」，用户不必担心数据丢失。 */
	if (!isOnline) {
		persistLocalDraft(currentDraft());
		cloudSync = "failed";
		return;
	}

	cloudSync = "syncing";
	const seq = ++cloudSeq;

	/* 并发闸门：参考 use-auto-save 用 inFlightRef 挡住并发写。
	   已有请求在飞时先等它结束，再判断内容是否已被那次保存覆盖。 */
	let settle!: () => void;
	cloudInFlight = new Promise<void>((resolve) => {
		settle = resolve;
	});

	try {
		const res = await fetch("/api/admin/draft/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...draft,
				// 新建模式固定落 create 槽：此时 slug 可能被自动生成或改动，
				// 若按 slug 分槽，草稿会随 slug 变化而“失联”，GET 也查不到。
				slug: mode === "create" ? "" : editorState.slug,
			}),
		});
		const data = await res.json();
		/* 代际校验：保存期间又有新改动（cloudSeq 已递增）则本次结果作废。
		   作废后必须把最新内容重新排一次——只 return 不重排的话，
		   最后一次改动永远等不到上传，本地有内容、云端却停在上一版。 */
		if (seq !== cloudSeq) {
			if (cloudTimer) clearTimeout(cloudTimer);
			cloudTimer = setTimeout(() => {
				void saveCloudDraft(currentDraft());
			}, 1500);
			return;
		}
		if (res.ok && data.success) {
			lastCloudKey = key;
			cloudSavedAt = data.savedAt ?? null;
			cloudSync = "synced";
			/* 保存期间内容又变了 → 重新排一次。
			   对应参考 attemptSave 末尾「保存后 isDirtyNow 则回到 PENDING 并重试」 */
			if (JSON.stringify(currentDraft()) !== lastCloudKey) {
				if (cloudTimer) clearTimeout(cloudTimer);
				cloudTimer = setTimeout(() => {
					void saveCloudDraft(currentDraft());
				}, 1500);
			}
		} else {
			/* 服务端返回非成功：同样先落本地再标失败 */
			persistLocalDraft(currentDraft());
			cloudSync = "failed";
		}
	} catch {
		if (seq === cloudSeq) {
			/* 网络异常：先落本地，保证「同步失败」不等于「改动丢了」 */
			persistLocalDraft(currentDraft());
			cloudSync = "failed";
		}
	} finally {
		cloudInFlight = null;
		settle();
	}
}

/* 设备网络状态：离线时不发请求、并把已同步状态立即降级；
   恢复在线后自动补一次，避免用户手动点重试。 */
function handleOnline() {
	isOnline = true;
	if (cloudSync === "failed" || cloudSync === "local-only") {
		void saveCloudDraft(currentDraft());
	}
}

function handleOffline() {
	isOnline = false;
	/* 此刻无法保证云端可达，正在同步或已同步都要如实降级 */
	if (cloudSync === "syncing" || cloudSync === "synced") {
		cloudSync = "failed";
	}
}

/** 手动保存前把挂起的自动保存立刻刷掉（对应参考的 flush） */ async function flushAutoSave(): Promise<void> {
	if (draftTimer) clearTimeout(draftTimer);
	if (cloudTimer) clearTimeout(cloudTimer);
	if (cloudInFlight) await cloudInFlight;
	const draft = currentDraft();
	if (JSON.stringify(draft) === lastCloudKey) return;
	await saveCloudDraft(draft);
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
	/** 写入这份草稿的浏览器与系统，恢复时用来告诉用户「哪台设备上的改动」 */
	device?: string;
	/** 内容指纹：时间戳只在内容真正变化时更新，见 persistLocalDraft */
	contentKey?: string;
	/**
	 * 用户已经确认过要这份草稿。
	 * 恢复后再进来不该重复询问「要恢复吗」——那会形成
	 * 「恢复 → 退出 → 回来又问」的死循环。
	 */
	restored?: boolean;
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

/** 冲突弹窗的三个出口 */
type DraftChoice = "draft" | "body" | "cancel";

/** 草稿与正文冲突弹窗的内容；null 表示未打开 */
let conflictPrompt = $state<{
	draft: {
		title: string;
		excerpt: string;
		words: number;
		meta: string;
		fromCloud: boolean;
	};
	body: { title: string; excerpt: string; words: number; meta: string };
} | null>(null);
let conflictResolve: ((choice: DraftChoice) => void) | null = null;

/** 打开选择框并等待用户决定。调用方 await 它，流程与 confirm 一致。 */
function askConflict(info: NonNullable<typeof conflictPrompt>) {
	conflictPrompt = info;
	conflictResolve = null;
	return new Promise<DraftChoice>((resolve) => {
		conflictResolve = resolve;
	});
}

function answerConflict(choice: DraftChoice) {
	conflictPrompt = null;
	const resolve = conflictResolve;
	conflictResolve = null;
	resolve?.(choice);
}

/**
 * 截一段纯文本用于并排对比：去掉 frontmatter、代码块、链接语法与 Markdown 标记，
 * 压成单行。对比框里放原文会让两张卡片高度差得离谱，也读不出「改了什么」。
 */
function excerptOf(text: string, limit = 90): string {
	const plain = (text ?? "")
		.replace(/^---[\s\S]*?\n---/, "")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[#>*_`~|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

/** 徽章里的时分；不带日期，同一天内足够，跨天由相对时间（横幅）负责 */
function clockOf(ts: number): string {
	return new Date(ts).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** 重新进入新建页时，恢复草稿：本地 localStorage 与云端各取较新者 */
async function restoreCreateDraft() {
	let local: DraftBlob | null = null;
	let localKey = DRAFT_KEY;
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (raw) local = JSON.parse(raw) as DraftBlob;
	} catch {
		// 备份损坏：忽略
	}
	/* 按当前槽读不到时反查其它槽：改过 slug 但没保存的草稿会落在旧槽里 */
	if (!local && mode === "edit" && post?.slug) {
		const found = findDraftBySlug(post.slug);
		if (found) {
			local = found.blob;
			localKey = found.key;
		}
	}
	let cloud: DraftBlob | null = null;
	/* 云端草稿对编辑页同样拉取。
	   本地 localStorage 换台机器就没了，跨设备继续写只有云端能覆盖。
	   风险靠下面的「与正文相同则跳过」控制：只有确实存在未保存改动才会恢复，
	   内容一致时直接清掉冗余草稿，不会把历史遗留的草稿当成正文。 */
	try {
		const res = await fetch(
			`/api/admin/draft/?slug=${encodeURIComponent(post?.slug ?? "")}`,
		);
		const data = await res.json();
		if (res.ok && data.success && data.draft) {
			cloud = data.draft as DraftBlob;
		}
	} catch {
		// 云端不可达：仅使用本地草稿
	}
	const localTs = local?.savedAt || 0;
	const cloudTs = cloud?.savedAt || 0;
	/* 用户确认过的草稿优先。按时间戳挑会选到另一侧那份旧的、无标记的副本，
	   一进来又判成「有未保存改动」，形成「恢复 → 打开 → 又问」的循环。 */
	const source = local?.restored
		? local
		: cloud?.restored
			? cloud
			: localTs >= cloudTs
				? local
				: cloud;
	if (!source || (!source.title && !source.content)) return;

	/* 用户此前已经确认过这份草稿（restored 标记）：不再追问，直接套用。
	   追问会形成「恢复 → 打开 → 又问一遍」的循环；但横幅照样显示，
	   让用户始终知道自己看的是草稿、不是正文。 */
	if (source.restored) {
		applyRestoredDraft(source, source === cloud, localKey, cloudTs);
		return;
	}

	/* 新建页没有「正文」可以冲突，草稿就是唯一内容：直接套用 + 横幅告知 */
	if (mode === "create") {
		applyRestoredDraft(source, source === cloud, localKey, cloudTs);
		return;
	}

	/* 编辑页：草稿与正文相同 → 只是冗余备份，清掉即可，不必打扰用户。
	   三个细节：
	     · 换行与首尾空白要归一化，否则 \r\n 与末尾空行会让同一份内容判成不同
	     · 草稿里为空的字段视为「没改过」：自动保存可能早于正文加载完成，
	       存下来的是一份只有部分字段的快照，拿空串参与比较必然判成有改动
	     · 只比这三个字段，其余元数据（tags / category 等）不影响是否提示 */
	const norm = (v: string | undefined) =>
		(v ?? "").replace(/\r\n/g, "\n").trim();
	const sameField = (draftVal: string | undefined, currentVal: string) =>
		!draftVal || norm(draftVal) === norm(currentVal);
	const sameAsPost =
		sameField(source.content, editorState.content) &&
		sameField(source.title, editorState.title) &&
		sameField(source.description, editorState.description);
	if (sameAsPost) {
		/* 正文已是最新：本地（含旧槽）与云端两份冗余草稿都要清掉。
		   只清本地的话，换台设备或清过浏览器数据后再进来，
		   还会被同一份冗余草稿拦一次。 */
		clearStoredDrafts(localKey);
		return;
	}

	/* 内容不同 = 真冲突。这里不再按「草稿有多新」决定是否静默套用：
	   静默套用会让人以为正文被改了，静默丢弃又可能丢掉刚写的东西。
	   把两份并排摆出来让用户选，是唯一不会误导的处理方式。 */
	const fromCloud = cloud !== null && (local === null || cloudTs > localTs);
	const choice = await askConflict({
		draft: {
			title: source.title ?? "",
			excerpt: excerptOf(source.content ?? ""),
			words: countWords(source.content ?? ""),
			meta: `${source.savedAt ? humanAgo(source.savedAt) : "之前"} · ${
				source.device ?? "未知设备"
			}`,
			fromCloud,
		},
		body: {
			title: editorState.title,
			excerpt: excerptOf(editorState.content),
			words: countWords(editorState.content),
			meta: i18n(I18nKey.postDraftConflictBodyMeta).replace(
				"{date}",
				post?.updated
					? formatDate(post.updated)
					: post?.published
						? formatDate(post.published)
						: "—",
			),
		},
	});

	/* 用正文：草稿当场清掉，否则每次进编辑页都问一遍 */
	if (choice === "body") {
		clearStoredDrafts(localKey);
		return;
	}
	/* 取消（Esc / 点遮罩）：先不动，草稿留着，下次进来再问 */
	if (choice === "cancel") return;

	applyRestoredDraft(source, fromCloud, localKey, cloudTs);
}

/**
 * 把草稿套进编辑区。
 *
 * 恢复前的表单就是正文内容，必须留作基线：之后拿它比对，恢复态才算「有改动」，
 * 自动保存才会继续落盘；基线设成恢复后的内容的话，后续编辑只停在内存里。
 */
function applyRestoredDraft(
	source: DraftBlob,
	fromCloud: boolean,
	localKey: string,
	cloudTs: number,
) {
	const baselineBeforeRestore = JSON.stringify(currentDraft());
	applyDraft(source);
	resetHistory();

	/* 恢复即落盘，并打上 restored 标记：
	   下次进来读到它就直接套用，不再问一遍——否则「恢复 → 退出 → 回来又问」
	   会一直循环下去。 */
	persistLocalDraft(currentDraft(), true);
	restoredDraftKey = JSON.stringify(currentDraft());
	dirty = true;

	/* 草稿来自别的槽（改过 slug 未保存）：搬到当前槽后清掉旧槽。 */
	if (localKey !== DRAFT_KEY) {
		try {
			localStorage.removeItem(localKey);
		} catch {
			// 迁移失败不影响本次恢复
		}
	}
	cloudSavedAt = cloudTs || null;
	if (cloudTs) cloudSync = "local-only";

	/* 横幅：草稿套进来之后，编辑区的内容就不再等于云端正文了 */
	draftBanner = {
		ago: source.savedAt ? humanAgo(source.savedAt) : "之前",
		device: source.device ?? "未知设备",
		fromCloud,
	};
	baselineDraftKey = baselineBeforeRestore;
}

/** 清掉这份文章的所有草稿副本：本地当前槽、反查到的旧槽、云端 */
function clearStoredDrafts(localKey: string) {
	try {
		localStorage.removeItem(DRAFT_KEY);
		if (localKey !== DRAFT_KEY) localStorage.removeItem(localKey);
	} catch {
		// 忽略清理失败
	}
	const cloudSlug = mode === "create" ? "" : (post?.slug ?? "");
	void fetch(`/api/admin/draft/?slug=${encodeURIComponent(cloudSlug)}`, {
		method: "DELETE",
	}).catch(() => {
		// 清理失败不影响本次打开
	});
}

/**
 * 「放弃草稿，回到正文」：先清本地与云端草稿，再整页重载。
 * 直接在当前页还原字段容易漏（正文、历史栈、基线、渲染结果都要回退），
 * 重载最稳，也符合用户「回到正文」的预期。
 */
function discardDraftAndReload() {
	clearStoredDrafts(DRAFT_KEY);
	draftBanner = null;
	/* 关掉 beforeunload 的拦截：这次重载是用户主动的，不该再弹一次「确定离开」 */
	dirty = false;
	window.location.reload();
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
			resetHistory();
			/* 记录加载完成时的内容基线：编辑页正文是异步载入的，若不记基线，
			   $effect 会因「内容从空变有值」立刻触发一次草稿写入，
			   一进编辑页就显示「仅本地」。 */
			baselineDraftKey = JSON.stringify(currentDraft());
		}
	}
}

onMount(() => {
	registerBeforeUnload();
	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);

	/* 必须先等正文加载完再比对草稿：编辑页要拿「已加载的正文」与草稿比较，
	   顺序反了会把草稿当成新改动、或把没有改动的旧草稿写回表单。 */
	void (async () => {
		await loadContent();
		await restoreCreateDraft();
	})();
});

onDestroy(() => {
	window.removeEventListener("online", handleOnline);
	window.removeEventListener("offline", handleOffline);
	if (draftTimer) clearTimeout(draftTimer);
	if (cloudTimer) clearTimeout(cloudTimer);
	if (historyTimer) clearTimeout(historyTimer);
	// 卸载时取消在途预览：否则服务端还会把这次 MDX evaluate 跑完
	if (renderTimer) clearTimeout(renderTimer);
	renderAbort?.abort();
	if (beforeUnloadHandler) {
		window.removeEventListener("beforeunload", beforeUnloadHandler);
	}
});

async function handleSave() {
	/* 标题留空时的兜底：
	   加密文章改用「前缀 + 时间」，绝不从正文里取——正文首行一旦当了标题，
	   加密就形同虚设。未加密的文章仍按 siteConfig.post.titleFallback 处理：
	   extract 取正文首个非空行（清掉 frontmatter、Markdown 标记与多余空白），
	   在首个中英文逗号或 maxLength 字处截断，二者先到先得；
	   filename 直接用文章标识；require 则拒绝保存。 */
	if (!editorState.title.trim()) {
		if (editorState.password.trim()) {
			editorState.title = buildEncryptedTitle();
		} else {
			const fallbackConf = siteConfig.post?.titleFallback ?? {};
			const mode = fallbackConf.mode ?? "extract";

			if (mode === "require") {
				onError(i18n(I18nKey.postTitleRequired));
				return;
			}

			let fallback = "";
			if (mode === "filename") {
				fallback = editorState.slug.trim();
			} else {
				const maxLength = fallbackConf.maxLength ?? 16;
				const stopAtComma = fallbackConf.stopAtComma !== false;
				const firstLine =
					editorState.content
						.replace(/^---[\s\S]*?\n---/, "")
						.split(/\r?\n/)
						.map((line) =>
							line
								.replace(/[#>*_`~[\]()!-]/g, "")
								.replace(/\s+/g, " ")
								.trim(),
						)
						.find((line) => line) ?? "";
				const commaAt = stopAtComma ? firstLine.search(/[,，]/) : -1;
				const limit = commaAt >= 0 ? Math.min(commaAt, maxLength) : maxLength;
				fallback = firstLine.slice(0, limit).trim();
			}

			if (!fallback) {
				onError(i18n(I18nKey.postTitleRequired));
				return;
			}
			editorState.title = fallback;
		}
	}

	/* 标题重名：输入时只是红字提醒，保存必须拦住。
	   服务端还有一道按 slug 的同名拦截（POST_EXISTS），这里挡的是「标题相同、
	   标识不同」的情况——两篇文章显示同名同样会让读者分不清。 */
	const selfSlug = mode === "edit" ? post?.slug : undefined;
	const conflict = findTitleConflict(
		await loadPostTitles(true),
		editorState.title,
		selfSlug,
	);
	if (conflict) {
		onError(i18n(I18nKey.postTitleDuplicate));
		return;
	}

	if (!editorState.slug.trim()) {
		onError(i18n(I18nKey.postSlugRequired));
		return;
	}

	isSaving = true;

	// 正式保存前先把手头挂起的自动保存刷掉，避免草稿与正文状态错位
	await flushAutoSave();

	try {
		const response = await fetch("/api/admin/save/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug: editorState.slug,
				/* 编辑页的原始标识：与当前 slug 不同时由服务端清理旧文件。
				   新建页没有「旧文件」，不传。 */
				originalSlug: mode === "edit" ? post?.slug : undefined,
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

		const data: AdminWriteResponse = await response.json();

		if (response.ok && data.success) {
			/* 标题清单变了（新建或改名），失效缓存，下一篇文章进来时重新拉 */
			invalidatePostTitles();
			try {
				localStorage.removeItem(DRAFT_KEY);
			} catch {
				// 忽略清理失败
			}
			// 文章已保存，清除云端草稿
			void fetch(
				`/api/admin/draft/?slug=${encodeURIComponent(post?.slug ?? "")}`,
				{ method: "DELETE" },
			).catch(() => {});
			lastCloudKey = "";
			cloudSavedAt = null;
			cloudSync = "idle";
			dirty = false;
			/* 正文已落盘：草稿不再代表任何未保存内容，横幅随之撤掉 */
			savedOnce = true;
			draftBanner = null;
			onSave(data.message);
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
/* 上一个预览请求的取消句柄：连续输入时服务端要真的跑 MDX evaluate，
   只靠 renderVersion 丢弃结果并不能让旧请求停下来。 */
let renderAbort: AbortController | null = null;

async function fetchPreview(mdContent: string) {
	if (!mdContent.trim()) {
		editorState.renderedHtml = `<p class='empty-preview'>${i18n(
			I18nKey.postPreviewEmpty,
		)}</p>`;
		return;
	}

	renderAbort?.abort();
	const controller = new AbortController();
	renderAbort = controller;

	const currentVersion = ++renderVersion;
	try {
		const response = await fetch("/api/admin/preview/", {
			signal: controller.signal,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			/* 带上真实文件路径：服务端据此判断是否按 MDX 解析，
			   否则 .mdx 里的 import / 自闭合 JSX 会被当成普通文本 */
			body: JSON.stringify({
				content: mdContent,
				filePath: post?.filePath ?? "",
			}),
		});
		const data = await response.json();

		// 防止旧请求覆盖新结果
		if (currentVersion === renderVersion && response.ok && data.success) {
			editorState.renderedHtml = data.html;
		}
	} catch {
		// 主动取消不是失败：直接返回，不要把「预览失败」闪给用户
		if (controller.signal.aborted) return;
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

<DraftConflictDialog
	open={conflictPrompt !== null}
	draft={conflictPrompt?.draft ?? {
		title: "",
		excerpt: "",
		words: 0,
		meta: "",
		fromCloud: false,
	}}
	body={conflictPrompt?.body ?? { title: "", excerpt: "", words: 0, meta: "" }}
	onUseDraft={() => answerConflict("draft")}
	onUseBody={() => answerConflict("body")}
	onCancel={() => answerConflict("cancel")}
/>

<div class="editor-shell">
	<header class="editor-header">
		<!-- 返回 + 状态徽章成组靠左：中间位置留给绝对居中的云端同步徽章 -->
		<div class="header-left">
			<button class="editor-back" onclick={onCancel}>
				<Icon icon="material-symbols:arrow-back" class="text-sm" />
				{i18n(I18nKey.postCancel)}
			</button>
			<!-- 文档状态：一眼看清「编辑区里的东西到底存没存进正文」。
			     草稿自动保存只保证内容不丢，并不等于保存，所以状态必须放在最显眼的位置 -->
			<span
				class="doc-state"
				class:is-dirty={docState === "dirty"}
				class:is-fresh={docState === "fresh"}
				title={docState === "dirty" && lastDraftSavedAt
					? i18n(I18nKey.postStateDraftAt).replace(
							"{time}",
							clockOf(lastDraftSavedAt),
						)
					: undefined}
			>
				<span class="doc-state-dot"></span>
				{docState === "dirty"
					? i18n(I18nKey.postStateDirty)
					: docState === "fresh"
						? i18n(I18nKey.postStateFresh)
						: i18n(I18nKey.postStateSaved)}
				{#if docState === "dirty" && lastDraftSavedAt}
					<span class="doc-state-time">{clockOf(lastDraftSavedAt)}</span>
				{/if}
			</span>
		</div>
		<div class="header-actions">
			<!-- 同步徽章对新建与编辑都显示：编辑页同样会自动保存草稿，
			     只对新页面提示会让编辑页的失败完全无感知 -->
			{#if cloudSync !== "idle"}
				<span
					class="cloud-badge"
					class:error={cloudSync === "failed"}
					class:syncing={cloudSync === "syncing"}
					class:local={cloudSync === "local-only"}
					title={cloudSync === "failed"
						? isOnline
							? i18n(I18nKey.cloudDraftFailed)
							: i18n(I18nKey.cloudDraftOffline)
						: undefined}
				>
					{#if cloudSync === "syncing"}
						<span class="cloud-spinner"></span>
						{i18n(I18nKey.cloudDraftSyncing)}
					{:else if cloudSync === "synced"}
						<Icon icon="material-symbols:cloud-done" class="text-sm" />
						{i18n(I18nKey.cloudDraftSaved)}
						{#if cloudSavedAt}
							{new Date(cloudSavedAt).toLocaleTimeString("zh-CN", {
								hour: "2-digit",
								minute: "2-digit",
							})}
						{/if}
					{:else if cloudSync === "local-only"}
						<Icon icon="material-symbols:cloud-off" class="text-sm" />
						{i18n(I18nKey.cloudDraftLocalOnly)}
					{:else}
						<Icon icon="material-symbols:cloud-off" class="text-sm" />
						{isOnline
							? i18n(I18nKey.cloudDraftFailed)
							: i18n(I18nKey.cloudDraftOffline)}
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
			<button
				class="editor-text-btn"
				class:is-active={drawer === "info"}
				aria-expanded={drawer === "info"}
				onclick={() => toggleDrawer("info")}
			>
				<Icon icon="material-symbols:info-outline" class="text-sm" />
				{i18n(I18nKey.postBasicInfo)}
			</button>
			<button
				class="editor-text-btn"
				class:is-active={drawer === "toc"}
				aria-expanded={drawer === "toc"}
				onclick={() => toggleDrawer("toc")}
			>
				<Icon icon="material-symbols:toc" class="text-sm" />
				{i18n(I18nKey.postToc)}
			</button>
			{#if mode === "edit" && post?.slug}
				<!-- 历史版本改为独立 URL（对齐参考的 history / history_.$revisionId 两个路由）。
				     跳转前先把草稿刷到本地/云端并清脏，否则 beforeunload 会把这次主动导航
				     当成「离开未保存页面」而弹提示。 -->
				<button
					class="editor-text-btn"
					onclick={async () => {
						await flushAutoSave();
						dirty = false;
						window.location.href = `/admin/posts/edit/${encodeURIComponent(
							post?.slug ?? "",
						)}/history/`;
					}}
				>
					<Icon icon="material-symbols:history-rounded" class="text-sm" />
					{i18n(I18nKey.postHistory)}
				</button>
			{/if}
			{#if mode === "edit" && onDelete}
				<button
					class="editor-delete"
					onclick={(e) => onDelete?.(e.currentTarget)}
					title={i18n(I18nKey.postDelete)}
				>
					<Icon icon="material-symbols:delete-outline" class="text-sm" />
					{i18n(I18nKey.postDelete)}
				</button>
			{/if}
			<button class="ui-btn ui-btn-primary" onclick={handleSave} disabled={isSaving}>
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

	<!-- 草稿横幅：套用草稿后编辑区里的内容已经不是云端正文，必须常驻标记，
	     否则用户会把它当成已保存的文章继续写，最后才发现正文没变 -->
	{#if draftBanner}
		<div class="draft-banner" role="status">
			<span class="draft-banner-icon">
				<Icon icon="material-symbols:notes-rounded" />
			</span>
			<div class="draft-banner-text">
				<strong>{i18n(I18nKey.postDraftBannerTitle)}</strong>
				<span>
					{i18n(I18nKey.postDraftBannerBody)
						.replace("{ago}", draftBanner.ago)
						.replace("{device}", draftBanner.device)}
					{#if draftBanner.fromCloud}
						（{i18n(I18nKey.postDraftConflictCloud)}）
					{/if}
				</span>
			</div>
			<button
				class="ui-btn ui-btn-soft draft-banner-action"
				onclick={discardDraftAndReload}
			>
				{i18n(I18nKey.postDraftBannerDiscard)}
			</button>
			<button
				class="draft-banner-close"
				aria-label={i18n(I18nKey.postDraftBannerDismiss)}
				title={i18n(I18nKey.postDraftBannerDismiss)}
				onclick={() => (draftBanner = null)}
			>
				<Icon icon="material-symbols:close" />
			</button>
		</div>
	{/if}

	{#if isLoadingContent}
		<div class="loading-editorState">
			<div class="loader"></div>
			<p>{i18n(I18nKey.postLoadingContent)}</p>
		</div>
	{:else}
		<div
			class="editor-body"
			class:is-resizing={resizing}
			style={`--editor-max-page-width: ${editorMaxWidth === null ? editorConfig.maxPageWidth : `${editorMaxWidth}px`}`}
		>
			<div class="editor-layout">
				<!-- 手柄挂在限宽容器内：它的 left/right 必须相对 layout 计算。
				     挂在 .editor-body 上时，布局缩窄了手柄仍钉在屏幕边缘，
				     看起来就是「拖了没反应」。 -->
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
				<PostEditorWritePanel />
			</div>

			{#if drawer !== "none"}
				<button
					class="editor-backdrop"
					aria-label={i18n(I18nKey.postCancel)}
					onclick={() => (drawer = "none")}
					transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}
				></button>
				<div
					class="editor-drawer"
					role="dialog"
					aria-modal="false"
					tabindex="-1"
					onkeydown={handleDrawerKeydown}
					transition:fly={{
						x: prefersReducedMotion.current ? 0 : 24,
						duration: prefersReducedMotion.current ? 0 : 180,
					}}
				>
					<header class="drawer-head">
						<h3>
							{drawer === "info" ? i18n(I18nKey.postBasicInfo) : i18n(I18nKey.postToc)}
						</h3>
						<button
							bind:this={drawerCloseEl}
							class="drawer-close"
							aria-label={i18n(I18nKey.postCancel)}
							onclick={() => (drawer = "none")}
						>
							<Icon icon="material-symbols:close" />
						</button>
					</header>
					<div class="drawer-body">
						{#if drawer === "info"}
							<PostEditorFmPanel />
						{:else}
							<PostEditorTocPanel />
						{/if}
					</div>
					<footer class="drawer-foot">
						<button
							type="button"
							class="ui-btn ui-btn-soft"
							onclick={() => (drawer = "none")}
						>
							{i18n(I18nKey.postInfoDone)}
						</button>
					</footer>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* 工作区：单张卡片，header 与书写区同处其内，用一条分隔线区分。
	   高度与左侧边栏同步：用 --admin-viewport-h（由 AdminDashboard 定义，
	   已在 .admin-content 的 zoom 内做过反算），避免被放大 43px。
	   overflow 不设在 shell 上——滚动交给内部 .content-editor。 */
	.editor-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
	}

	/* 编辑页顶栏：shell 已限高，header 作为 flex 固定项不再需要 sticky */
	/* 删除：头部最安静的一个动作，悬停才升到红 */
	.editor-delete {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		height: 36px;
		padding: 0 0.625rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--content-meta);
		font: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	.editor-delete:hover {
		color: color-mix(in srgb, var(--destructive) 88%, var(--deep-text));
		background: color-mix(in srgb, var(--destructive) 10%, transparent);
	}

	.editor-delete:focus-visible {
		outline: 2px solid var(--destructive);
		outline-offset: 2px;
	}

	.editor-header {
		position: relative;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-shrink: 0;
		gap: 1rem;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--line-divider);
		background: var(--card-bg);
		border-radius: var(--radius-large) var(--radius-large) 0 0;
	}

	/* 左侧返回 + 状态徽章：两者成组，避免与绝对居中的同步徽章抢位置 */
	.header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	/* ── 文档状态徽章 ──
	   和右上角的「云端同步」徽章回答的是两个问题：
	   这里＝编辑区的内容有没有写进正文；那里＝草稿有没有传到云端。
	   已保存用中性灰（不必强调），有未保存改动用主色（需要留意），
	   新建未保存用警示黄（一次都没存过，风险最高）。 */
	.doc-state {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		border: 1px solid var(--line-divider);
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.doc-state-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.7;
	}

	.doc-state.is-dirty {
		border-color: color-mix(in oklab, var(--primary) 40%, transparent);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
		color: var(--primary);
	}

	.doc-state.is-fresh {
		border-color: color-mix(in oklab, var(--warning, #b8860b) 40%, transparent);
		background: color-mix(in oklab, var(--warning, #b8860b) 12%, transparent);
		color: var(--warning, #b8860b);
	}

	/* 草稿最后一次写入的时分：与「草稿 · 未保存」并排，弱一档 */
	.doc-state-time {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	/* ── 草稿横幅 ──
	   套用草稿后常驻，直到保存或用户主动放弃。用主色的浅底而非警示色：
	   它不是错误，只是「你正在改的东西还没进正文」这件事需要一直被看见 */
	.draft-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
		padding: 0.625rem 1.5rem;
		border-bottom: 1px solid
			color-mix(in oklab, var(--primary) 28%, transparent);
		background: color-mix(in oklab, var(--primary) 8%, transparent);
		color: var(--deep-text);
	}

	.draft-banner-icon {
		display: flex;
		flex-shrink: 0;
		color: var(--primary);
		font-size: 1.125rem;
	}

	.draft-banner-text {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		min-width: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--content-meta);
	}

	.draft-banner-text strong {
		color: var(--primary);
		font-weight: 600;
		white-space: nowrap;
	}

	.draft-banner-action {
		margin-left: auto;
		flex-shrink: 0;
	}

	.draft-banner-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.draft-banner-close:hover {
		background: color-mix(in oklab, var(--deep-text) 8%, transparent);
	}

	/* 窄屏：横幅里的说明文字会挤成一列，按钮也不再靠右，改为换行堆叠 */
	@media (max-width: 640px) {
		.draft-banner {
			flex-wrap: wrap;
			padding-inline: 1rem;
		}

		.draft-banner-action {
			margin-left: 0;
		}
	}

	/* 左侧返回 + 右侧文字按钮：共用无底色样式，hover 才浮现浅底（对齐参考 header 的层级） */
	.editor-back,
	.editor-text-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		height: 2.75rem;
		padding: 0 0.875rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--content-meta);
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.editor-back:hover,
	.editor-text-btn:hover {
		background: var(--btn-regular-bg);
		color: var(--btn-content);
	}

	.editor-text-btn.is-active {
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		color: var(--primary);
	}

	.cloud-badge {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		max-width: min(26rem, 52vw);
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}

	.cloud-badge.syncing {
		color: var(--info);
		background: color-mix(in srgb, var(--info) 12%, transparent);
		border-color: color-mix(in srgb, var(--info) 30%, transparent);
	}

	/* 仅本地：中性灰——没同步但也不算失败，与「同步失败」的红色区分开 */
	.cloud-badge.local {
		color: var(--content-meta);
		background: color-mix(in srgb, var(--content-meta) 10%, transparent);
		border-color: color-mix(in srgb, var(--content-meta) 28%, transparent);
	}

	.cloud-badge.error {
		color: var(--destructive);
		background: color-mix(in srgb, var(--destructive) 12%, transparent);
		border-color: color-mix(in srgb, var(--destructive) 30%, transparent);
	}

	.cloud-spinner {
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid color-mix(in srgb, var(--info) 25%, transparent);
		border-top-color: var(--info);
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
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-left: auto;
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
		border: 3px solid var(--muted);
		border-top-color: var(--primary);
		border-radius: 50%;
		margin: 0 auto 1rem;
		animation: spin 0.8s linear infinite;
	}

	.loading-editorState p {
		color: var(--content-meta);
	}

	/* 单栏工作区：元数据与目录收进右侧抽屉（原三栏改为写作区独占）。
	   flex:1 + min-height:0 让它在 shell 限高内分配剩余空间；
	   overflow:hidden 只裁这一层的溢出，真正的滚动在 .content-editor。 */
	.editor-body {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.editor-layout {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		max-width: var(--editor-max-page-width, 96rem);
		margin-inline: auto;
		width: 100%;
		height: 100%;
	}

	/* ── 拖拽手柄 ──
	   贴在工作区左右两侧，10px 热区；悬停/拖拽时显示主色细线，
	   松手后宽度写入 localStorage（admin-editor-max-width）。 */
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
		right: 0;
	}

	.resize-handle:hover,
	.editor-body.is-resizing .resize-handle {
		background: color-mix(in srgb, var(--primary) 22%, transparent);
	}

	/* 拖拽过程中屏蔽文本选中，避免整页文字被反白 */
	.editor-body.is-resizing {
		user-select: none;
	}

	/* ── 右侧抽屉：基本信息 / 目录 共用外壳，内容按 drawer 切换 ── */
	.editor-backdrop {
		position: absolute;
		inset: 0;
		z-index: 20;
		padding: 0;
		border: none;
		background: rgb(20 35 50 / 0.12);
		cursor: default;
	}

	.editor-drawer {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		width: min(100%, 22rem);
		background: var(--card-bg);
		border-left: 1px solid var(--line-divider);
		box-shadow: -12px 0 24px rgb(0 0 0 / 0.06);
	}

	.drawer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-shrink: 0;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--line-color);
	}

	.drawer-head h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.drawer-close {
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
	}

	.drawer-close:hover {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	.drawer-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1.25rem;
	}

	.drawer-foot {
		flex-shrink: 0;
		display: flex;
		justify-content: flex-end;
		padding: 0.875rem 1.25rem;
		border-top: 1px solid var(--line-color);
	}

	/* footer 按钮对齐参考（fuwari-btn-regular h-9 rounded-lg px-4 text-sm） */
	.drawer-foot .ui-btn {
		height: 2.25rem;
		padding: 0 1rem;
		font-size: 0.875rem;
	}

	@media (max-width: 768px) {
		/* 高度基准已由 .admin-layout 在窄屏把 --admin-viewport-h 改写为 100%
		   （移动端多了 .mobile-topbar，按视口算会多出顶栏高度）。
		   这里显式再兜一层：父级高度万一无法解析时退化为可伸缩项。 */
		.editor-shell {
			height: 100%;
			min-height: 0;
			border-radius: var(--radius-large);
		}

		.editor-header {
			flex-direction: column;
			align-items: stretch;
			gap: 0.75rem;
			/* 顶栏在小屏不必留大内边距，省下的高度全给正文 */
			padding: 0.875rem 1rem;
		}

		.editor-back {
			align-self: flex-start;
		}

		/* 窄屏下「返回 + 状态徽章」一行放不下时换行，避免把状态挤出屏幕 */
		.header-left {
			flex-wrap: wrap;
		}

		.cloud-badge {
			position: static;
			transform: none;
			align-self: center;
		}

		.header-actions {
			width: 100%;
			/* 手机上四个动作按钮挤在一行会溢出：允许换行、按内容均分，
			   保证「保存」始终可见且热区不被压窄 */
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		/* 左右拖拽改宽只在有多余横向空间时成立，手机上没有可拖的余量，
		   10px 热区反而会吃掉正文边缘的点击（容易误触发拖动） */
		.resize-handle {
			display: none;
		}

		/* 抽屉占满内容区：小屏右滑抽屉若只占 360px，剩下的窄条既看不清
		   也点不准，不如整屏呈现 */
		.editor-drawer {
			width: 100%;
			max-width: none;
		}
	}
</style>