<script lang="ts">
import { onDestroy, onMount, setContext } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { fade, fly } from "svelte/transition";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AdminWriteResponse } from "@/types/adminApi";
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
const EDITOR_WIDTH_MIN = 720;

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

/* ── 历史版本（主从两栏，结构照参考 post-history-page.tsx + history-list + history-document）──
   左列表显示「时间 / 原因 / 标题」，点选后右侧只读渲染该版本正文；
   恢复按钮在详情区，且恢复前有确认弹窗（对应参考的 ConfirmationModal）。 */
type RevisionItem = {
	id: string;
	reason: string;
	savedAt: number;
	title: string;
	category: string;
	tags: string[];
};

let historyOpen = $state(false);
let historyLoading = $state(false);
let historyItems = $state<RevisionItem[]>([]);
let historySelectedId = $state("");
let historyDetailHtml = $state("");
let historyDetailLoading = $state(false);
let historyConfirmOpen = $state(false);
let historyBusyId = $state("");

function fmtRevisionTime(ts: number): string {
	if (!ts) return "—";
	const d = new Date(ts);
	return `${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)}`;
}

/** 原因标签：对齐参考的 getRevisionReasonLabel 三态 */
function revisionReasonLabel(reason: string): string {
	switch (reason) {
		case "publish":
			return i18n(I18nKey.postHistoryReasonPublish);
		case "restore_backup":
			return i18n(I18nKey.postHistoryReasonRestore);
		default:
			return i18n(I18nKey.postHistoryReasonAuto);
	}
}

const selectedRevision = $derived(
	historyItems.find((r) => r.id === historySelectedId) ?? null,
);

async function openHistory() {
	historyOpen = true;
	historyLoading = true;
	historyItems = [];
	historySelectedId = "";
	historyDetailHtml = "";
	try {
		const res = await fetch(
			`/api/admin/post-revisions/?slug=${encodeURIComponent(post?.slug ?? "")}`,
		);
		const data = await res.json();
		historyItems = data.success ? (data.revisions ?? []) : [];
		if (historyItems.length) await selectRevision(historyItems[0].id);
	} catch {
		historyItems = [];
	} finally {
		historyLoading = false;
	}
}

/** 选中某个版本：取全文 → 剥 frontmatter → 走与预览相同的渲染管线 */
async function selectRevision(id: string) {
	historySelectedId = id;
	historyDetailHtml = "";
	historyDetailLoading = true;
	try {
		const res = await fetch(
			`/api/admin/post-revisions/?slug=${encodeURIComponent(post?.slug ?? "")}&id=${encodeURIComponent(id)}`,
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
		historyDetailHtml = pdata.success ? (pdata.html ?? "") : "";
	} catch {
		historyDetailHtml = "";
	} finally {
		historyDetailLoading = false;
	}
}

function requestRestore() {
	if (!historySelectedId || historyBusyId) return;
	historyConfirmOpen = true;
}

async function confirmRestore() {
	historyConfirmOpen = false;
	const id = historySelectedId;
	if (!id) return;
	historyBusyId = id;
	try {
		const res = await fetch("/api/admin/post-revisions/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug: post?.slug, id }),
		});
		const data = await res.json();
		if (data.success) {
			historyOpen = false;
			await loadContent();
			onError(data.message ?? "");
		} else {
			onError(data.message ?? "恢复失败");
		}
	} catch {
		onError("恢复请求失败");
	} finally {
		historyBusyId = "";
	}
}

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
		editorMaxWidth = Math.min(viewport, Math.max(EDITOR_WIDTH_MIN, next));
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
	};
}

/**
 * 把草稿落到本地 localStorage，返回是否写入成功。
 * 云端同步失败时会直接调用它，确保「失败」不等于「数据丢了」。
 * 注意：写入本身不改状态，由调用方决定展示 local-only 还是 failed。
 */
function persistLocalDraft(draft: DraftFields): boolean {
	try {
		localStorage.setItem(
			DRAFT_KEY,
			JSON.stringify({ ...draft, savedAt: Date.now() }),
		);
		return true;
	} catch {
		// 隐私模式 / 配额不足：写不进去，由调用方按「未保存」处理
		return false;
	}
}

$effect(() => {
	/* 正文还在加载时一律不产生草稿：编辑页的 content 会从空被填满，
	   否则会先把「空内容」存一次（日志里的「字符数 0」就是这么来的）。 */
	if (isLoadingContent) return;
	const draft: DraftFields = currentDraft();
	// 草稿自动保存对新建与编辑都生效：编辑页同样会因误关标签页丢改动。
	// 去抖时长对齐参考 use-auto-save.ts 的 debounceMs 默认值 1500ms。
	if (!hasDraftContent()) return;
	/* 与加载时的基线一致 → 用户还没改过，不写草稿。
	   否则编辑页一进来就会因「正文从空变有值」触发一次保存并显示「仅本地」。 */
	if (JSON.stringify(draft) === baselineDraftKey) return;
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
	dirty = true;
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
		// 代际校验：保存期间又有新改动（cloudSeq 已递增）则丢弃本次结果
		if (seq !== cloudSeq) return;
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
	let local: DraftBlob | null = null;
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (raw) local = JSON.parse(raw) as DraftBlob;
	} catch {
		// 备份损坏：忽略
	}
	let cloud: DraftBlob | null = null;
	/* 云端草稿只对新建页兜底：编辑页正文本身就在服务端，再叠加一层云端草稿
	   容易把「历史遗留草稿」当成正文恢复，风险大于收益。 */
	if (mode === "create") {
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
	}
	const localTs = local?.savedAt || 0;
	const cloudTs = cloud?.savedAt || 0;
	const source = localTs >= cloudTs ? local : cloud;
	if (!source || (!source.title && !source.content)) return;

	/* 编辑页：草稿必须与刚加载的正文不同，才说明有未保存改动。
	   相同就直接跳过，避免把旧草稿无谓地写回表单。 */
	if (mode === "edit") {
		const sameAsPost =
			(source.content ?? "") === editorState.content &&
			(source.title ?? "") === editorState.title &&
			(source.description ?? "") === editorState.description;
		if (sameAsPost) {
			// 正文已是最新，清掉这份冗余草稿
			try {
				localStorage.removeItem(DRAFT_KEY);
			} catch {
				// 忽略
			}
			return;
		}
	}

	applyDraft(source);
	resetHistory();
	cloudSavedAt = cloudTs || null;
	if (cloudTs) cloudSync = "local-only";
	/* 恢复后的内容就是当前基线：不更新的话会被当成「用户刚改动」，
	   立刻又触发一次草稿写入。 */
	baselineDraftKey = JSON.stringify(currentDraft());
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
	if (beforeUnloadHandler) {
		window.removeEventListener("beforeunload", beforeUnloadHandler);
	}
});

async function handleSave() {
	/* 标题改为非必填：留空时用正文前 16 个字符兜底。先清掉 frontmatter 残留、
	   Markdown 标记与多余空白，避免生成「# 标题」或「---」这样的标题。 */
	if (!editorState.title.trim()) {
		const fallback = editorState.content
			.replace(/^---[\s\S]*?\n---/, "")
			.replace(/[#>*_`~[\]()!-]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 16);
		if (!fallback) {
			onError(i18n(I18nKey.postTitleRequired));
			return;
		}
		editorState.title = fallback;
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
		<button class="editor-back" onclick={onCancel}>
			<Icon icon="material-symbols:arrow-back" class="text-sm" />
			{i18n(I18nKey.postCancel)}
		</button>
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
				<!-- 历史版本改为独立 URL（对齐参考的 history / history_.$revisionId 两个路由） -->
				<button
					class="editor-text-btn"
					onclick={() => {
						window.location.href = `/admin/posts/edit/${encodeURIComponent(
							post?.slug ?? "",
						)}/history/`;
					}}
				>
					<Icon icon="material-symbols:history-rounded" class="text-sm" />
					{i18n(I18nKey.postHistory)}
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
			<!-- 左右拖拽手柄：向内拖 = 变窄，交互同 VSCode 侧栏分隔条 -->
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
			<div class="editor-layout">
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

<!-- 历史版本：左列表 + 右只读预览（结构照参考 post-history-page 的主从布局）。
     恢复按钮在详情区，且恢复前先弹确认——对应参考的 ConfirmationModal。 -->
{#if historyOpen}
	<div
		class="history-overlay"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) historyOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") historyOpen = false;
		}}
	>
		<div class="history-card">
			<div class="history-head">
				<h3>{i18n(I18nKey.postHistory)}</h3>
			</div>

			{#if historyLoading}
				<p class="history-note">…</p>
			{:else if historyItems.length === 0}
				<p class="history-note">{i18n(I18nKey.postHistoryEmpty)}</p>
			{:else}
				<div class="history-body">
					<!-- 左：版本列表，三项式（时间 / 原因 / 标题） -->
					<div class="history-list">
						{#each historyItems as item (item.id)}
							<button
								type="button"
								class="history-version"
								class:is-selected={item.id === historySelectedId}
								aria-current={item.id === historySelectedId ? "true" : undefined}
								onclick={() => selectRevision(item.id)}
							>
								<time class="history-time">{fmtRevisionTime(item.savedAt)}</time>
								<span class="history-reason">{revisionReasonLabel(item.reason)}</span>
								<span class="history-version-title">{item.title || "—"}</span>
							</button>
						{/each}
					</div>

					<!-- 右：只读预览 + 恢复入口 -->
					<div class="history-detail">
						{#if historyDetailLoading}
							<p class="history-note">…</p>
						{:else if !selectedRevision}
							<p class="history-note">{i18n(I18nKey.postHistoryEmpty)}</p>
						{:else}
							<div class="history-detail-head">
								<h4>{selectedRevision.title || "—"}</h4>
								<button
									class="history-restore"
									type="button"
									disabled={Boolean(historyBusyId)}
									onclick={requestRestore}
								>
									{i18n(I18nKey.postHistoryRestore)}
								</button>
							</div>
							<!-- 横幅：对齐参考 post-editor-history-document 的
							     m.editor_history_banner_title({ time }) -->
							<p class="history-note">
								{i18n(I18nKey.postHistoryBannerTitle).replace(
									"{time}",
									fmtRevisionTime(selectedRevision.savedAt),
								)}
								· {revisionReasonLabel(selectedRevision.reason)}
							</p>
							<!-- 分类与标签摘要：对齐参考 PostEditorSummary（图标 + 文本） -->
							<div class="history-meta">
								<span>
									<Icon icon="material-symbols:menu-book" />
									{selectedRevision.category || "—"}
								</span>
								{#if selectedRevision.tags.length}
									<span class="history-meta-tags">
										<Icon icon="material-symbols:label" />
										{selectedRevision.tags.join(" · ")}
									</span>
								{/if}
							</div>
							<!-- biome-ignore lint/security/noDangerouslySetInnerHtml: 服务端渲染管线产出的可信 HTML -->
							<div class="history-doc custom-md">{@html historyDetailHtml}</div>
						{/if}
					</div>
				</div>
			{/if}
			<!-- 弃用 X 关闭图标，底部统一给「取消」 -->
			<div class="history-actions">
				<button
					class="history-btn"
					type="button"
					onclick={() => (historyOpen = false)}
				>
					{i18n(I18nKey.postCancel)}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- 恢复确认（对应参考的 history.confirm === "restore"） -->
{#if historyConfirmOpen}
	<div
		class="history-overlay"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) historyConfirmOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") historyConfirmOpen = false;
		}}
	>
		<div class="history-confirm">
			<h3>{i18n(I18nKey.postHistoryRestoreTitle)}</h3>
			<p class="history-note">{i18n(I18nKey.postHistoryRestoreMessage)}</p>
			<div class="history-confirm-actions">
				<button
					class="history-btn"
					type="button"
					onclick={() => (historyConfirmOpen = false)}
				>
					{i18n(I18nKey.taxonomyCancel)}
				</button>
				<button
					class="history-btn is-primary"
					type="button"
					onclick={confirmRestore}
				>
					{i18n(I18nKey.postHistoryRestore)}
				</button>
			</div>
		</div>
	</div>
{/if}

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
		.editor-header {
			flex-direction: column;
			align-items: stretch;
		}

		.editor-back {
			align-self: flex-start;
		}

		.cloud-badge {
			position: static;
			transform: none;
			align-self: center;
		}

		.header-actions {
			width: 100%;
		}
	}
	/* ── 历史版本：主从两栏 ──
	   左列固定 16rem 放版本列表，右侧自适应放只读预览；
	   尺寸参考 post-history-page 的工作区卡片（整屏高、左右分栏）。 */
	.history-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.35);
	}

	.history-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: min(56rem, 92vw);
		height: min(36rem, 82vh);
		padding: 1.25rem;
		border-radius: var(--radius-large);
		background: var(--card-bg);
		box-shadow: 0 16px 40px rgb(0 0 0 / 0.3);
	}

	.history-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.history-head h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.history-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.history-body {
		display: grid;
		grid-template-columns: 16rem minmax(0, 1fr);
		gap: 0.75rem;
		flex: 1;
		min-height: 0;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	/* 列表项三项式：时间 / 原因 / 标题（标题两行截断），选中态抬底 + 主色时间 */
	.history-version {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}

	.history-version:hover {
		background: color-mix(in srgb, var(--btn-regular-bg) 60%, transparent);
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

	.history-detail {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem 0.5rem;
	}

	.history-detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.history-detail-head h4 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.history-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	/* 版本摘要：分类 / 标签，图标 + 文本，对齐参考 PostEditorSummary 的排布 */
	.history-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.history-meta span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.history-meta-tags {
		min-width: 0;
	}

	.history-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.history-doc {
		font-size: 0.875rem;
	}

	.history-restore {
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.history-restore:hover:not(:disabled) {
		border-color: var(--primary);
		color: var(--primary);
	}

	.history-restore:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* 恢复确认弹窗 */
	.history-confirm {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: min(24rem, 90vw);
		padding: 1.25rem;
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
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.history-btn.is-primary {
		border-color: transparent;
		background: var(--primary);
		color: var(--primary-foreground);
	}
</style>