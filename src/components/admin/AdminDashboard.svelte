<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AdminPostsResponse } from "@/types/adminApi";
import { probeAdminService, runProbeWithStages } from "@/utils/admin-probe";
import {
	CONFIG_ITEMS,
	getConfigDescKey,
	getConfigItem,
	getConfigLabelKey,
} from "@/utils/admin-settings";
import { isTourDone, resetTour } from "@/utils/onboarding";
import AdminPage from "./AdminPage.svelte";
import DeleteConfirmModal from "./DeleteConfirmModal.svelte";
import OnboardingTour from "./OnboardingTour.svelte";
import PostEditor from "./PostEditor.svelte";
import PostHistoryPage from "./PostHistoryPage.svelte";
import PostList from "./PostList.svelte";
import SecretManager from "./SecretManager.svelte";
import SessionManager from "./SessionManager.svelte";
import SettingsEditor from "./SettingsEditor.svelte";
import TaxonomyManager from "./TaxonomyManager.svelte";

type Post = {
	id: string;
	slug: string;
	title: string;
	author: string;
	category: string;
	tags: string[];
	published: string;
	updated: string | null;
	draft: boolean;
	description: string;
	image: string;
	pinned: boolean;
	filePath: string;
};

type ViewMode = "list" | "edit" | "create";
type Page =
	| "dashboard"
	| "posts"
	/** 文章历史版本（独立 URL，见 Route.page === "history"） */
	| "history"
	| "categories-and-tags"
	| "settings"
	| "env"
	| "sessions"
	| "404";

// 基于 URL 路径的真实路由（History API）：
//   /admin/                      → 首页
//   /admin/posts/                → 文章列表
//   /admin/posts/new/            → 新建文章
//   /admin/posts/edit/:slug/     → 编辑文章
//   /admin/categories/           → 分类管理
//   /admin/tags/                 → 标签管理
//   /admin/settings/             → 网站配置（概览）
//   /admin/settings/:key/        → 网站配置（具体配置文件子页）
//   /admin/env/                  → 环境变量（密钥配置等）
//   /admin/user/、/admin/secrets/ → 旧地址，归一化到 /admin/env/
//   /admin/articles/*            → 旧地址，归一化到 /admin/posts/*
type Route =
	| { page: "login" }
	| { page: "dashboard" }
	| { page: "posts" }
	| { page: "create" }
	| { page: "edit"; slug: string }
	/** 历史版本：/admin/posts/edit/:slug/history/[:revisionId]/ */
	| { page: "history"; slug: string; revisionId: string }
	| { page: "categories-and-tags" }
	| { page: "settings"; section?: string }
	| { page: "env" }
	/* 会话管理：从设置页独立出来，入口挂在侧栏 */
	| { page: "sessions" }
	/* 无效路径：不在后台内渲染任何页面，直接交给项目原有的 /404 */
	| { page: "404" };

let {
	avatarUrl = "",
	siteName = "",
	logoType = "icon",
	logoValue = "",
	logoUrl = null,
	logoAlt = "",
	logoFollowTheme = false,
}: {
	avatarUrl?: string;
	siteName?: string;
	logoType?: "icon" | "image" | "url";
	logoValue?: string;
	logoUrl?: string | null;
	logoAlt?: string;
	logoFollowTheme?: boolean;
} = $props();

// 直接读取会话状态，避免后台页在未登录时先闪现登录表单
let isVerified = $state(
	typeof sessionStorage !== "undefined"
		? sessionStorage.getItem("admin_verified") === "true"
		: false,
);
let adminUsername = $state("");
// 存储降级：KV 熔断时后台仍可用（仅 JWT 鉴权），但会话表能力受限
let storageDegraded = $state(false);
let posts = $state<Post[]>([]);
let isLoading = $state(true);
let error = $state("");
let route = $state<Route>({ page: "login" });
let editingPost = $state<Post | null>(null);
let showDeleteModal = $state(false);
let deletingPost = $state<Post | null>(null);
let deleteTrigger: HTMLElement | null = null;
let toast = $state<{ message: string; type: "success" | "error" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
// 环境变量页保存栏状态：由 SecretManager 上报，保存栏渲染在
// AdminPage 的 footer 槽位（滚动容器之外，始终可见）
let secretSaveState = $state<{
	writable: boolean;
	loading: boolean;
	saving: boolean;
	changedCount: number;
	dirtyItems: { key: string; label: string }[];
	scrollToField: (key: string) => void;
	save: () => void;
	discard: () => void;
} | null>(null);
// 保存栏改动清单是否展开
let dirtyListOpen = $state(false);
// 站内切换页面时的未保存拦截：leaveConfirmOpen 为真即弹出确认框，
// pendingPath 记录确认后要跳转的目标路径。
// 注意不要用「函数作 $state」——Svelte 对函数值不会触发重渲染。
let leaveConfirmOpen = $state(false);
let pendingPath = $state("");
let tourOpen = $state(false);
let isSyncing = $state(false);
// GitHub 连通性状态：idle=默认（未测试） / checking=测试中 / ok=连接正常 / fail=无法连接
let githubStatus = $state<"idle" | "checking" | "ok" | "fail">("idle");
// GitHub 状态图标映射（icon: 属性形式声明，供构建期图标扫描识别）
const githubIconProps: Record<
	"idle" | "checking" | "ok" | "fail",
	{ icon: string }
> = {
	idle: { icon: "material-symbols:cloud-done-outline" },
	checking: { icon: "material-symbols:sync" },
	ok: { icon: "material-symbols:cloud-done-outline" },
	fail: { icon: "material-symbols:cloud-off-outline" },
};
// 后台服务连通性状态：与 GitHub 同构
let adminStatus = $state<"idle" | "checking" | "ok" | "fail">("idle");
// 单次请求 + 浏览器实测的网络阶段分解。
// 结果不内联在状态行里，改由「查看详情」进入内嵌详情页展示，
// 避免探测完成后卡片被动增高、左右两栏高度失衡。
let adminProbeResults = $state<
	{ label: string; ms: number; isTotal?: boolean; detail?: string }[]
>([]);
// 当前所处测试步骤的文案：测试过程中替换掉「测试中/连接正常」，
// 使状态区高度恒定，同时让用户看到进展到哪一步
let adminProbeStage = $state("");
// 当前步骤序号：驱动步骤指示条逐段点亮
let adminProbeStageIndex = $state(0);
// 是否已完成过一次完整探测：决定按钮是「测试连通性」还是「查看详情」
let adminProbeDone = $state(false);
// 详情视图开关：在卡片内容区内部切换，不跳转路由
let adminStatusDetail = $state(false);
// 探针端点：requireAuth 会查一次 KV，选最轻的 ping 端点，
// 串行多端点会把耗时与 KV 查询次数成倍放大。
const ADMIN_PROBE_URL = "/api/admin/service-ping/";
// 探测步骤序列：文案复用既有 probe* key，保证与详情页分段行完全一致。
// 顺序对应 PerformanceResourceTiming 的四个阶段。
const ADMIN_PROBE_STAGES = [
	I18nKey.probeDns,
	I18nKey.probeConnect,
	I18nKey.probeRequest,
	I18nKey.probeDownload,
] as const;
// 每一步的最短驻留时间(ms)。本地回环请求常常几十毫秒就返回，
// 步骤文案还没来得及渲染就被结果覆盖，因此请求与推进并行、
// 并为每步保底驻留时长：再快的请求也能看清逐步推进，
// 慢请求则自然由真实耗时接续，不额外拖慢。
const ADMIN_STAGE_MIN_DWELL = 180;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const adminIconProps: Record<
	"idle" | "checking" | "ok" | "fail",
	{ icon: string }
> = {
	idle: { icon: "material-symbols:dns-outline" },
	checking: { icon: "material-symbols:sync" },
	ok: { icon: "material-symbols:check-circle-outline" },
	fail: { icon: "material-symbols:cloud-off-outline" },
};
// 网站配置详情页状态（操作按钮提升到页头，由父级统一管理）
// json 配置为对象；html 等原始文本配置为字符串
let settingsData = $state<Record<string, any> | string | null>(null);
let settingsError = $state("");
let settingsLoading = $state(false);
let settingsSaving = $state(false);
// 配置文件的磁盘原文（源码模式用）；settingsMode 记录当前编辑模式
let settingsSource = $state("");
let settingsMode = $state<"form" | "source">("form");
// 线上（Serverless）环境：配置仅存于 GitHub 远程仓库，只能源码模式编辑
let settingsRemote = $state(false);
// 后台页头：深浅模式切换按钮的当前状态（亮色显示月亮图标，暗色显示太阳）
let isDark = $state(false);

// 深浅模式切换：与应用全局主题保持一致（localStorage "theme" + html.dark/data-theme）
function toggleTheme() {
	const next = isDark ? "light" : "dark";
	document.documentElement.classList.toggle("dark", next === "dark");
	document.documentElement.setAttribute("data-theme", next);
	localStorage.setItem("theme", next);
	isDark = next === "dark";
}
// 侧边栏状态
let isSidebarOpen = $state(false); // 移动端侧边栏抽屉是否打开
let sidebarCollapsed = $state(false); // 桌面端侧边栏是否折叠（仅图标模式）

if (typeof window !== "undefined") {
	const savedCollapsed = localStorage.getItem("admin-sidebar-collapsed");
	if (savedCollapsed === "true") sidebarCollapsed = true;
}

// 折叠/展开侧边栏：折叠时仅保留图标
function toggleCollapseSidebar() {
	sidebarCollapsed = !sidebarCollapsed;
	localStorage.setItem("admin-sidebar-collapsed", String(sidebarCollapsed));
}

const activePage = $derived<Page>(
	route.page === "404"
		? "404"
		: route.page === "dashboard"
			? "dashboard"
			: route.page === "history"
				? "history"
				: route.page === "settings"
					? "settings"
					: route.page === "env"
						? "env"
						: route.page === "categories-and-tags"
							? "categories-and-tags"
							: route.page === "sessions"
								? "sessions"
								: "posts",
);

const viewMode = $derived<ViewMode>(
	route.page === "create" ? "create" : route.page === "edit" ? "edit" : "list",
);

const settingsSection = $derived(
	route.page === "settings" ? route.section : undefined,
);

/**
 * 设置页当前 tab：直接对应具体配置项。
 *
 * 没有「配置概览」这一层——/admin/settings/ 会重定向到第一个配置项，
 * 概览页已移除（它会让 admin-content 走无 workspace 容器的分支，
 * 高度计算异常，影响整体布局）。
 */
const settingsTab = $derived.by(() => {
	if (route.page !== "settings") return null;
	return route.section ?? CONFIG_ITEMS[0]?.key ?? null;
});

/** 设置页 tab 列表：全部配置项（按 CONFIG_ITEMS 原顺序） */
const settingsTabs = $derived(
	CONFIG_ITEMS.map((item) => ({
		id: item.key,
		labelKey: getConfigLabelKey(item.key),
	})),
);

/** 切到某个 tab：直接跳对应配置项详情页 */
function goSettingsTab(tabId: string) {
	goSettings(tabId);
}

const stats = $derived({
	total: posts.length,
	published: posts.filter((p) => !p.draft).length,
	drafts: posts.filter((p) => p.draft).length,
	pinned: posts.filter((p) => p.pinned).length,
});

const greeting = $derived.by(() => {
	const hour = new Date().getHours();
	if (hour < 6) return i18n(I18nKey.greetingNight);
	if (hour < 12) return i18n(I18nKey.greetingMorning);
	if (hour < 18) return i18n(I18nKey.greetingAfternoon);
	return i18n(I18nKey.greetingEvening);
});

const currentDate = $derived(
	new Date().toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "long",
	}),
);

const recentPosts = $derived(
	[...posts]
		.sort(
			(a, b) =>
				new Date(b.updated ?? b.published).getTime() -
				new Date(a.updated ?? a.published).getTime(),
		)
		.slice(0, 6),
);

// 暂不使用：内容概览已注释（见 contentOverview snippet）
// const publishRate = $derived(
// 	stats.total > 0 ? Math.round((stats.published / stats.total) * 100) : 0,
// );

// 进入编辑路由时按 slug 找到对应文章（文章列表异步加载完成后会自动再次匹配）
$effect(() => {
	// 先用局部变量承载 route，避免 $state 代理导致 TS 无法对联合类型收窄
	const current = route;
	if (current.page !== "edit") {
		editingPost = null;
		return;
	}
	editingPost = posts.find((p) => p.slug === current.slug) ?? null;
});

function parseRoute(pathname: string): Route {
	const rest = pathname.replace(/^\/admin\/?/, "");
	// 不在后台前缀下视为未知路由，回落到登录态判定
	if (rest === pathname) return { page: "login" };
	const segments = rest.split("/").filter(Boolean);
	switch (segments[0]) {
		case undefined:
			return { page: "dashboard" };
		case "posts":
			if (segments[1] === "new") return { page: "create" };
			if (segments[1] === "edit" && segments[2]) {
				/* 历史版本走独立 URL（与参考的路由结构一致）：
				   /admin/posts/edit/:slug/history/             ← 列表
				   /admin/posts/edit/:slug/history/:revisionId/ ← 选中某版本
				   参考的 history.tsx / history_.$revisionId.tsx 两个路由在此合并为一条
				   路径模式，revisionId 为空即列表页。 */
				if (segments[3] === "history") {
					return {
						page: "history",
						slug: segments[2],
						revisionId: segments[4] ?? "",
					};
				}
				return { page: "edit", slug: segments[2] };
			}
			// 仅 /admin/posts/ 是列表页，其余子路径无效
			return segments.length === 1 ? { page: "posts" } : { page: "404" };
		case "articles":
			// 兼容旧链接：/admin/articles/* 归一化到 /admin/posts/*
			if (segments[1] === "new") return { page: "create" };
			if (segments[1] === "edit" && segments[2])
				return { page: "edit", slug: segments[2] };
			return segments.length === 1 ? { page: "posts" } : { page: "404" };
		case "categories-and-tags":
			return segments.length === 1
				? { page: "categories-and-tags" }
				: { page: "404" };
		case "categories":
		case "tags":
			// 兼容旧链接：分类与标签已合并到一个工作台，旧入口一律渲染合并页
			return segments.length === 1
				? { page: "categories-and-tags" }
				: { page: "404" };
		case "settings": {
			// /admin/settings/ 无子段时落到第一个配置项（概览层已移除）；
			// 显式给了未知 section 视为无效地址
			if (!segments[1])
				return { page: "settings", section: CONFIG_ITEMS[0]?.key };
			return CONFIG_ITEMS.some((item) => item.key === segments[1])
				? { page: "settings", section: segments[1] }
				: { page: "404" };
		}
		case "env":
			// 环境变量页（原 /admin/user/）
			return segments.length === 1 ? { page: "env" } : { page: "404" };
		case "sessions":
			return segments.length === 1 ? { page: "sessions" } : { page: "404" };
		case "secrets":
		case "user":
			// 兼容旧链接：/admin/user/、/admin/secrets/ 归一化到 /admin/env/
			return segments.length === 1 ? { page: "env" } : { page: "404" };
		default:
			return { page: "404" };
	}
}

function applyRoute() {
	// 未登录：跳回独立登录页（/login/），不再在后台页内展示登录
	if (!isVerified) {
		route = { page: "login" };
		window.location.replace("/login/");
		return;
	}
	const next = parseRoute(window.location.pathname);
	// 无效路径在后台内渲染 404（保留地址，不跳走）
	route = next.page === "login" ? { page: "dashboard" } : next;
	// 环境变量页：旧地址 /admin/user/、/admin/secrets/ 归一化到 /admin/env/
	if (next.page === "env") {
		const path = window.location.pathname.replace(/\/$/, "");
		if (!path.endsWith("/env")) {
			window.history.replaceState({}, "", `${DASHBOARD_PATH}env/`);
		}
	}
	// 文章管理：旧地址 /admin/articles/* 归一化到 /admin/posts/*
	if (next.page === "posts" || next.page === "create" || next.page === "edit") {
		if (/^\/admin\/articles(?:\/|$)/.test(window.location.pathname)) {
			window.history.replaceState(
				{},
				"",
				window.location.pathname.replace(
					/^\/admin\/articles(?=\/|$)/,
					"/admin/posts",
				),
			);
		}
	}
	// 设置页已无概览层：/admin/settings/ 归一化到第一个配置项的真实地址，
	// 避免地址栏与渲染内容不一致
	if (
		next.page === "settings" &&
		next.section &&
		!window.location.pathname.replace(/\/$/, "").endsWith(next.section)
	) {
		window.history.replaceState(
			{},
			"",
			`${DASHBOARD_PATH}settings/${next.section}/`,
		);
	}
}

function startAdmin() {
	loadPosts();
	window.addEventListener("popstate", applyRoute);
	applyRoute(); // 同步初始路由
	// 首次进入控制台：自动弹出新手指引
	if (!isTourDone()) {
		tourOpen = true;
	}
}

onMount(async () => {
	// 同步当前主题状态（深浅切换按钮图标）
	isDark = document.documentElement.classList.contains("dark");
	// 侧边栏底部用户卡片展示的管理员用户名（与会话接口同一来源）；
	// 同时以服务端会话为准校正本地登录态——Cookie 失效（过期 / 被踢 / 换设备）
	// 时 sessionStorage 的 admin_verified 可能残留，若盲信会让后台照常渲染但
	// 接口全部 401（各页显示「加载失败」），或与独立登录页互相重定向形成回弹循环。
	try {
		const res = await fetch("/api/admin/session/");
		const data = await res.json();
		if (!data.success) throw new Error("session invalid");
		isVerified = true;
		sessionStorage.setItem("admin_verified", "true");
		if (typeof data.username === "string" && data.username) {
			adminUsername = data.username;
		}
		// 存储后端告警：KV 熔断时会话表暂不可用，踢下线等能力受限。
		// 不阻塞进入后台（鉴权已回落到仅 JWT 校验），只做可见提示。
		storageDegraded = Boolean(data.storage?.degraded);
	} catch {
		// 无法确认会话（未授权或网络异常）：清除残留标记，回独立登录页。
		// 必须清 admin_verified，否则登录页会立刻把用户弹回本页形成死循环。
		isVerified = false;
		sessionStorage.removeItem("admin_verified");
		sessionStorage.removeItem("admin_redirect");
		window.location.replace("/login/");
		return;
	}
	startAdmin();
});

// 移动端 TopBar 标题随页面联动（桌面端已无全局 header）
const headerTitle = $derived.by(() => {
	if (activePage === "404") return i18n(I18nKey.notFoundTitle);
	if (activePage === "dashboard") return i18n(I18nKey.adminDashboard);
	if (activePage === "settings") {
		const item = settingsSection ? getConfigItem(settingsSection) : undefined;
		return item
			? i18n(getConfigLabelKey(item.key))
			: i18n(I18nKey.adminSettings);
	}
	if (activePage === "env") return i18n(I18nKey.adminEnvVars);
	if (activePage === "sessions") return i18n(I18nKey.adminSessions);
	if (activePage === "categories-and-tags")
		return i18n(I18nKey.adminCategoriesAndTags);
	if (viewMode === "edit" && editingPost) return i18n(I18nKey.adminEditPost);
	if (viewMode === "create") return i18n(I18nKey.adminNewPost);
	return i18n(I18nKey.adminPosts);
});

/* 浏览器标签标题跟随当前页：后台是 SPA（pushState 切页），若不主动写
   document.title，标签页会一直停在首屏进入时的标题。 */
$effect(() => {
	if (typeof document !== "undefined") document.title = headerTitle;
});

async function loadPosts() {
	isLoading = true;
	error = "";
	try {
		const response = await fetch("/api/admin/posts/");
		const data: AdminPostsResponse = await response.json();
		if (data.success) {
			posts = data.posts;
		} else {
			error = data.message || "获取文章列表失败";
		}
	} catch {
		error = "网络请求失败";
	} finally {
		isLoading = false;
	}
}

// 进入网站配置子页时加载对应配置文件（key 变化时重新加载）
$effect(() => {
	if (
		activePage === "settings" &&
		settingsSection &&
		getConfigItem(settingsSection)
	) {
		loadSettings(settingsSection);
	}
});

/**
 * 读取后台页 HTML 中注入的配置快照（构建时数据，AdminLayout 注入）。
 * 未注入/解析失败返回 null，调用方回落 API。
 */
function readDomConfigSnapshot(): Record<
	string,
	{ data?: unknown; source?: string }
> | null {
	const el = document.getElementById("admin-config-snapshot");
	if (!el) return null;
	const raw = el.getAttribute("data-snapshot");
	if (!raw || raw === "{}") return null;
	try {
		return JSON.parse(raw) as Record<
			string,
			{ data?: unknown; source?: string }
		>;
	} catch {
		return null;
	}
}

async function loadSettings(key: string) {
	settingsLoading = true;
	settingsError = "";
	// 重新加载配置时回到默认的可视化表单模式
	settingsMode = "form";

	// 优先使用构建时注入页面的配置快照（Serverless 下免 API、零服务端文件依赖）
	const snapshot = readDomConfigSnapshot()?.[key];
	if (snapshot) {
		settingsData =
			(snapshot.data as Record<string, any> | string | null) ?? null;
		settingsSource = snapshot.source ?? "";
		settingsRemote = true;
		// 无快照数据（html/求值失败）时直接进入源码编辑模式
		if (snapshot.data === undefined || snapshot.data === null)
			settingsMode = "source";
		settingsLoading = false;
		settingsError = "";
		return;
	}

	try {
		const res = await fetch(`/api/admin/configs/${key}/`);
		let json: {
			success: boolean;
			data?: unknown;
			source?: string;
			message?: string;
			remote?: boolean;
		};
		try {
			json = await res.json();
		} catch {
			throw new Error(`服务器返回异常（HTTP ${res.status}）`);
		}
		if (json.success) {
			settingsData = json.data as Record<string, any> | string | null;
			settingsSource = json.source ?? "";
			settingsRemote = !!json.remote;
			// 线上环境无本地数据时直接进入源码编辑模式；有构建快照则可用表单
			if (json.remote && json.data === null) settingsMode = "source";
		} else {
			settingsError = json.message || "读取配置失败";
		}
	} catch (err) {
		settingsError = err instanceof Error ? err.message : "网络请求失败";
	} finally {
		settingsLoading = false;
	}
}

async function saveSettings() {
	const key = settingsSection;
	// 线上（源码模式）可以无本地数据保存；本地表单模式必须有已加载的数据
	if (!key || (settingsMode !== "source" && settingsData === null)) return;
	settingsSaving = true;
	try {
		const cfgItem = key ? getConfigItem(key) : undefined;
		// 运行时配置（可视化表单）：写入 KV 覆盖层，即时生效、不触发重建。
		if (cfgItem?.runtime && settingsMode !== "source") {
			const res = await fetch(`/api/admin/runtime-config/${key}/`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: settingsData }),
			});
			const json = (await res.json().catch(() => null)) as {
				success?: boolean;
				message?: string;
			} | null;
			if (json?.success) {
				showToast(json.message || "已保存并即时生效", "success");
			} else {
				showToast(json?.message || "保存失败", "error", 10000);
			}
			return;
		}
		const res = await fetch(`/api/admin/configs/${key}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// 源码模式整份写回文件原文；可视化表单模式由后端序列化配置值
			body: JSON.stringify(
				settingsMode === "source"
					? { source: settingsSource }
					: { data: settingsData },
			),
		});
		let json: { success: boolean; message?: string };
		try {
			json = await res.json();
		} catch {
			throw new Error(`服务器返回异常（HTTP ${res.status}）`);
		}
		if (json.success) {
			showToast(json.message || "保存成功", "success");
		} else {
			showToast(json.message || "保存失败", "error", 10000);
		}
	} catch (err) {
		showToast(
			`保存请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		settingsSaving = false;
	}
}

async function handleSync() {
	isSyncing = true;
	showToast("正在从 GitHub 同步文章...", "success", 5000);
	try {
		const response = await fetch("/api/admin/sync/", { method: "POST" });
		const data = await response.json();
		if (data.success) {
			// 同步成功后刷新本地文章列表
			await loadPosts();
			const stats = data.stats;
			let detail = "";
			if (stats) {
				detail = `（GitHub 共 ${stats.githubTotal} 篇，本地 ${stats.localTotal} 篇）`;
			}
			showToast(`${data.message}${detail}`, "success", 6000);
			// 如有本地独有文章，额外提示
			if (stats?.orphanedFiles?.length > 0) {
				console.log(
					"[Sync] 本地独有文章（GitHub 不存在）:",
					stats.orphanedFiles,
				);
			}
		} else {
			showToast(data.message || "同步失败", "error", 10000);
		}
	} catch (err) {
		showToast(
			`同步请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		isSyncing = false;
	}
}

async function testConnectivity() {
	if (githubStatus === "checking") return;
	githubStatus = "checking";
	let result: { ok: boolean; message: string };
	try {
		const res = await fetch("/api/admin/github-ping/");
		const data = await res.json();
		result = data.success
			? { ok: true, message: `GitHub 连接正常（${data.latency}ms）` }
			: { ok: false, message: data.message || "GitHub 连接失败" };
	} catch (err) {
		result = {
			ok: false,
			message: `请求失败: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	githubStatus = result.ok ? "ok" : "fail";
	showToast(result.message, result.ok ? "success" : "error", 6000);
}

/**
 * 「后台服务」行按钮：未测过就发起探测，已测过则进入内嵌详情页。
 * 两种行为共用一个按钮位，避免卡片高度与按钮位置在测试前后发生位移。
 */
function openStatusAction() {
	if (adminProbeDone) {
		adminStatusDetail = true;
		return;
	}
	adminStatusDetail = false;
	testAdminService();
}

function closeStatusDetail() {
	adminStatusDetail = false;
}

async function testAdminService() {
	if (adminStatus === "checking") return;
	adminStatus = "checking";
	// 不在此处关闭详情：详情面板内的「重新测试」也走这里，
	// 关掉会让用户在测试过程中被踢回列表。是否进入详情由调用方决定。
	adminProbeResults = [];
	adminProbeDone = false;
	adminProbeStageIndex = 0;
	adminProbeStage = i18n(ADMIN_PROBE_STAGES[0]);

	// 单次请求。分段数据全部来自浏览器对该请求的实测（PerformanceResourceTiming），
	// 不额外发请求，测得的耗时与改动前完全一致。
	const href = new URL(ADMIN_PROBE_URL, location.href).href;

	// 请求与步骤推进并行：请求照常发，UI 侧按最短驻留时间逐步推进文案，
	// 二者互不阻塞——请求慢时由真实耗时接续，请求快时步骤仍完整可见。
	const request = probeAdminService(href, {
		badResponse: i18n(I18nKey.probeBadResponse),
		networkError: i18n(I18nKey.probeNetworkError),
	});

	const stepper = (async () => {
		for (let i = 1; i < ADMIN_PROBE_STAGES.length; i++) {
			await sleep(ADMIN_STAGE_MIN_DWELL);
			adminProbeStageIndex = i;
			adminProbeStage = i18n(ADMIN_PROBE_STAGES[i]);
		}
	})();

	// 结果取自 request 而非 stepper（后者只推进 UI，无返回值）；
	// 这一约定由 runProbeWithStages 固化，曾在此处因误按对象解构
	// 而让线上显示「无法连接: undefined」
	const probe = await runProbeWithStages(request, stepper);
	const { ok, failure, serverMs, serverMin, serverMedian, serverMax } = probe;

	// 只在失败时打印：失败时能直接看到原始 failure，
	// 比只读 toast 文案更容易判断是网络问题还是端点返回异常。
	if (!ok) {
		console.warn("[Probe] 探测失败", { failure, href });
	}

	const timing = performance.getEntriesByName(href, "resource").at(-1);
	const total = timing ? Math.round(timing.responseEnd - timing.startTime) : 0;
	// 分段耗时仅在请求结束后才可从 PerformanceResourceTiming 读到，
	// 故失败或条目缺失时不再渲染残缺列表，避免出现「只有总耗时」的孤立行。
	adminProbeResults = timing
		? [
				{
					label: i18n(I18nKey.probeDns),
					ms: Math.max(
						0,
						Math.round(timing.domainLookupEnd - timing.domainLookupStart),
					),
				},
				{
					label: i18n(I18nKey.probeConnect),
					ms: Math.max(0, Math.round(timing.connectEnd - timing.connectStart)),
				},
				{
					label: i18n(I18nKey.probeRequest),
					ms: Math.max(
						0,
						Math.round(timing.responseStart - timing.requestStart),
					),
				},
				{
					label: i18n(I18nKey.probeDownload),
					ms: Math.max(
						0,
						Math.round(timing.responseEnd - timing.responseStart),
					),
				},
				...(serverMs > 0
					? [
							{
								label: i18n(I18nKey.probeStoreRoundTrip),
								ms: serverMedian,
								// 展示 min～max 区间而非单值：KV 延迟实测在 280–800ms
								// 间波动，单个数字无法说明后端是否稳定。
								// min === max 说明无波动，无需标注。
								detail:
									serverMin < serverMax ? `${serverMin}–${serverMax}` : "",
							},
						]
					: []),
				{ label: i18n(I18nKey.probeTotal), ms: total, isTotal: true },
			]
		: [];
	adminProbeDone = true;
	adminProbeStage = "";
	adminStatus = ok ? "ok" : "fail";
	showToast(
		ok
			? `${i18n(I18nKey.statusAdminService)}${i18n(I18nKey.statusConnected)}（${total}${i18n(I18nKey.probeUnitMs)}）`
			: `${i18n(I18nKey.statusDisconnected)}: ${failure}`,
		ok ? "success" : "error",
		6000,
	);
}

/* 登出二次确认：点侧栏「退出登录」先弹确认框，避免误触把会话清掉。
   真正的清理动作在 performLogout，两处命名别混。 */
let logoutConfirmOpen = $state(false);

function handleLogout() {
	logoutConfirmOpen = true;
}

async function performLogout() {
	logoutConfirmOpen = false;
	isVerified = false;
	sessionStorage.removeItem("admin_verified");
	// 退出后回到独立登录页，同时清掉深链记录，避免下次登录被带回旧页
	sessionStorage.removeItem("admin_redirect");
	// 清除服务端会话 Cookie（含"记住我"的 7 天 Cookie），否则退出后仍会免登录
	try {
		await fetch("/api/admin/verify/", { method: "DELETE" });
	} catch {
		// 忽略清理失败
	}
	window.location.replace("/login/");
}

// ── 导航（History API 真实路径路由） ──
const DASHBOARD_PATH = "/admin/";

function navigate(path: string) {
	isSidebarOpen = false;
	if (window.location.pathname === path) {
		applyRoute();
		return;
	}
	// 站内切换页面时若存在未保存改动，先弹确认框（对应参考项目 useBlocker）。
	// 留在环境变量页内（同 path）不拦，与参考项目 shouldBlockFn 一致。
	const hasDirty = (secretSaveState?.changedCount ?? 0) > 0;
	const leavingEnv =
		activePage === "env" && !path.startsWith(`${DASHBOARD_PATH}env`);
	if (hasDirty && leavingEnv) {
		pendingPath = path;
		leaveConfirmOpen = true;
		return;
	}
	history.pushState({}, "", path);
	applyRoute();
}

/** 确认离开：执行挂起的跳转 */
function confirmLeave() {
	const path = pendingPath;
	leaveConfirmOpen = false;
	pendingPath = "";
	if (path) {
		history.pushState({}, "", path);
		applyRoute();
	}
}

function goDashboard() {
	navigate(DASHBOARD_PATH);
}

function goSettings(section?: string) {
	navigate(
		section
			? `${DASHBOARD_PATH}settings/${section}/`
			: `${DASHBOARD_PATH}settings/`,
	);
}

function goEnv() {
	navigate(`${DASHBOARD_PATH}env/`);
}

function goSessions() {
	navigate(`${DASHBOARD_PATH}sessions/`);
}

function goCategoriesAndTags() {
	navigate(`${DASHBOARD_PATH}categories-and-tags/`);
}

function goPostList() {
	navigate(`${DASHBOARD_PATH}posts/`);
}

function goCreatePost() {
	navigate(`${DASHBOARD_PATH}posts/new/`);
}

function goEditPost(post: Post) {
	navigate(`${DASHBOARD_PATH}posts/edit/${post.slug}/`);
}

function handleEditPost(post: Post) {
	goEditPost(post);
}

function handleSaveSuccess() {
	loadPosts();
	showToast("保存成功", "success");
	goPostList();
}

function handleCancelEdit() {
	goPostList();
}

function handleDeleteClick(post: Post, trigger?: HTMLElement | null) {
	deletingPost = post;
	/* 删除入口是 ··· 菜单里的一项，菜单收起时该项会从 DOM 移除，
	   所以由 PostRowMenu 直接把 ··· 触发器传过来——只要那一行还在它就在。
	   没传触发器时退回 activeElement，保持原行为。 */
	deleteTrigger =
		trigger ??
		(typeof document !== "undefined" &&
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null);
	showDeleteModal = true;
}

/* 删除成功后触发它的按钮随行一起消失，直接归还会让焦点落回 body，
   键盘用户被丢到页面开头。此时改落到搜索框——它不在 {#each} 里，列表重载期间始终在。 */
function restoreDeleteFocus(useTrigger: boolean) {
	const target =
		useTrigger && deleteTrigger?.isConnected
			? deleteTrigger
			: document.querySelector<HTMLElement>("[data-post-list-search]");
	target?.focus();
	deleteTrigger = null;
}

async function handleConfirmDelete() {
	if (!deletingPost) return;

	/* 只有删除成功才会让触发行消失，其余路径触发元素仍在，原路归还即可 */
	let rowSurvives = true;
	try {
		const response = await fetch("/api/admin/delete/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug: deletingPost.slug,
				title: deletingPost.title,
			}),
		});
		const data = await response.json();
		if (data.success) {
			showToast("删除成功", "success");
			rowSurvives = false;
			loadPosts();
		} else {
			console.error("[Admin] 删除失败:", data.message);
			showToast(data.message || "删除失败", "error", 10000);
		}
	} catch (err) {
		console.error("[Admin] 删除请求异常:", err);
		showToast(
			`删除请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		/* 归还焦点必须先于卸载：对话框销毁会清掉它内部输入框占着的焦点 */
		restoreDeleteFocus(rowSurvives);
		showDeleteModal = false;
		deletingPost = null;
	}
}

function showToast(
	message: string,
	type: "success" | "error",
	duration = 6000,
) {
	toast = { message, type };
	if (type === "error") {
		console.error("[Toast] Error:", message);
	}
	// 先清除上一个定时器，避免旧定时器提前关掉新提示
	if (toastTimer) {
		clearTimeout(toastTimer);
	}
	toastTimer = setTimeout(() => {
		toast = null;
		toastTimer = null;
	}, duration);
}

function closeToast() {
	toast = null;
}

function formatDate(dateStr: string | null): string {
	if (!dateStr) return "—";
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
</script>

{#snippet placeholder(title: string, desc: string, icon: string)}
	<div class="card-base placeholder-page">
		<div class="placeholder-icon">
			<Icon icon={icon} class="text-3xl" />
		</div>
		<h2>{title}</h2>
		<p>{desc}</p>
		<span class="placeholder-badge">{i18n(I18nKey.placeholderBadge)}</span>
	</div>
{/snippet}

<!-- 后台 404：结构与 src/pages/404.astro 一致（大号 404 + 图标 + 标题 +
     描述 + 返回按钮 + 两枚角落装饰），改用后台路由（返回控制面板） -->
{#snippet adminNotFound()}
	<!-- 卡片宽高与内边距对齐参考项目 404：max-width 680、padding 48/32、
	     外层 24 留白；相对内容区水平垂直居中 -->
	<div class="flex min-h-full w-full items-center justify-center p-6">
		<div class="card-base notfound-card relative z-10 flex w-full max-w-[680px] flex-col items-center justify-center px-8 py-12 text-center max-sm:px-6 max-sm:py-9">
			<div class="mb-4 text-8xl font-bold text-(--primary) opacity-20 md:text-9xl">
				{i18n(I18nKey.notFound)}
			</div>
			<div class="mb-6">
				<Icon icon="material-symbols:error-outline" class="notfound-404-icon" />
			</div>
			<div class="mb-4 text-3xl font-bold text-90 md:text-4xl">
				{i18n(I18nKey.notFoundTitle)}
			</div>
			<p class="mb-8 max-w-md text-lg text-75">
				{i18n(I18nKey.notFoundDescription)}
			</p>
			<button
				type="button"
				class="notfound-back inline-flex items-center gap-2 rounded-(--radius-large) bg-(--primary) px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-(--btn-content)"
				onclick={goDashboard}
			>
				<Icon icon="material-symbols:home" class="text-xl" />
				{i18n(I18nKey.backToHome)}
			</button>
			<div class="absolute top-4 left-4 opacity-10">
				<Icon icon="material-symbols:sentiment-sad" class="notfound-404-deco" />
			</div>
			<div class="absolute right-4 bottom-4 opacity-10">
				<Icon icon="material-symbols:search-off" class="notfound-404-deco" />
			</div>
		</div>
	</div>
{/snippet}

{#snippet statCard(label: string, value: number, icon: string)}
	<div class="stat-card">
		<p class="stat-title">{label}</p>
		<p class="stat-subtitle">
			{i18n(I18nKey.dashboardUnit).replace("{count}", String(value))}
		</p>
		<Icon
			icon={icon}
			class="stat-deco-icon"
			style="font-size: 3rem"
			aria-hidden="true"
		/>
	</div>
{/snippet}

{#snippet welcomeBanner()}
	<div class="welcome-banner">
		<div class="welcome-content">
			<div class="welcome-greeting">
				<Icon icon="material-symbols:waving-hand-outline" class="welcome-icon" />
				<span>{i18n(I18nKey.welcomeGreeting).replace("{greeting}", greeting)}</span>
			</div>
			<h2>{i18n(I18nKey.welcomeTitle)}</h2>
			<p>{currentDate}</p>
		</div>
		<div class="welcome-actions">
			<button class="welcome-btn primary" onclick={goCreatePost}>
				<Icon icon="material-symbols:edit-square-outline" />
				<span>{i18n(I18nKey.adminNewPost)}</span>
			</button>
		</div>
	</div>
{/snippet}

{#snippet recentPostsSection()}
	<div class="card-base dashboard-section recent-posts">
		<div class="section-header">
			<h2>{i18n(I18nKey.recentPostsTitle)}</h2>
			<button class="section-link" onclick={goPostList}>{i18n(I18nKey.viewAll)}</button>
		</div>
		{#if recentPosts.length === 0}
			<div class="empty-state">
				<Icon icon="material-symbols:article-outline" class="empty-icon" />
				<p>{i18n(I18nKey.noRecentPosts)}</p>
			</div>
		{:else}
			<div class="post-list">
				{#each recentPosts as post (post.id)}
					<button class="post-item" onclick={() => handleEditPost(post)}>
						<div class="post-status-dot" data-draft={post.draft}></div>
						<div class="post-info">
							<span class="post-title">{post.title}</span>
							<span class="post-meta"
								>{i18n(I18nKey.postMetaStatus)
									.replace("{status}", post.draft ? i18n(I18nKey.postDraft) : i18n(I18nKey.postPublished))
									.replace("{date}", formatDate(post.updated ?? post.published))}</span
							>
						</div>
						<Icon icon="material-symbols:chevron-right" class="post-arrow" />
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<!-- {#snippet contentOverview()}
<!-- 	<div class="card-base dashboard-section content-overview">
<!-- 		<div class="section-header">
<!-- 			<h2>{i18n(I18nKey.contentOverviewTitle)}</h2>
<!-- 		</div>
<!-- 		<div class="overview-chart">
<!-- 			<div class="chart-ring">
<!-- 				<svg viewBox="0 0 36 36" class="ring-svg">
<!-- 					<path
<!-- 						class="ring-bg"
<!-- 						d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
<!-- 					/>
<!-- 					<path
<!-- 						class="ring-fill published"
<!-- 						stroke-dasharray="{publishRate}, 100"
<!-- 						d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
<!-- 					/>
<!-- 				</svg>
<!-- 				<div class="ring-label">
<!-- 					<span class="ring-value">{publishRate}%</span>
<!-- 					<span class="ring-caption">{i18n(I18nKey.postPublished)}</span>
<!-- 				</div>
<!-- 			</div>
<!-- 			<div class="chart-legend">
<!-- 				<div class="legend-item">
<!-- 					<span class="legend-dot published"></span>
<!-- 					<span class="legend-label">{i18n(I18nKey.postPublished)}</span>
<!-- 					<span class="legend-count">{stats.published}</span>
<!-- 				</div>
<!-- 				<div class="legend-item">
<!-- 					<span class="legend-dot draft"></span>
<!-- 					<span class="legend-label">{i18n(I18nKey.postDraft)}</span>
<!-- 					<span class="legend-count">{stats.drafts}</span>
<!-- 				</div>
<!-- 				<div class="legend-item">
<!-- 					<span class="legend-dot pinned"></span>
<!-- 					<span class="legend-label">{i18n(I18nKey.pinned)}</span>
<!-- 					<span class="legend-count">{stats.pinned}</span>
<!-- 				</div>
<!-- 			</div>
<!-- 		</div>
<!-- 	</div>
<!-- {/snippet}
-->

{#snippet systemStatus()}
	<div class="card-base dashboard-section system-status">
		<div class="section-header">
			<h2>{i18n(I18nKey.systemStatus)}</h2>
			{#if adminStatusDetail}
				<button type="button" class="section-link" onclick={closeStatusDetail}>
					<Icon icon="material-symbols:arrow-back" />
					{i18n(I18nKey.statusDetailBack)}
				</button>
			{/if}
		</div>
		{#if adminStatusDetail}
			<!-- 内嵌详情视图：仅在用户主动点击「查看详情」后进入，
			     高度变化由用户触发，不会再有探测完成时突然增高的割裂感 -->
			<div class="status-detail">
				<div class="status-detail-head">
					<Icon
						{...adminIconProps[adminStatus]}
						class="status-icon {adminStatus === 'fail' ? 'error' : 'healthy'}"
					/>
					<div class="status-info">
						<span class="status-label">{i18n(I18nKey.statusAdminService)}</span>
<span class="status-value">
						<!-- 与下方状态列表保持一致的三分支：idle（尚未测试）与
						     checking（测试中）都不是「无法连接」。此前这里只有
						     ok/fail 两分支，会把「从未测过」误报成「服务已断」 -->
						{adminProbeStage
							? adminProbeStage
							: adminStatus === "ok"
								? i18n(I18nKey.statusConnected)
								: adminStatus === "fail"
									? i18n(I18nKey.statusDisconnected)
									: i18n(I18nKey.statusRunning)}
					</span>
					</div>
					<button
						type="button"
						class="connectivity-btn"
						onclick={testAdminService}
						disabled={adminStatus === "checking"}
					>
						{i18n(I18nKey.statusTestConnectivity)}
					</button>
				</div>
				{#if adminProbeResults.length > 0}
					<div class="probe-list">
						{#each adminProbeResults as step, idx (idx)}
							<div class="probe-row" class:total={step.isTotal}>
								<span class="probe-label">{step.label}</span>
								<span class="probe-bar">
									<span
										class="probe-bar-fill"
										style:width={`${Math.min(100, (step.ms / Math.max(1, adminProbeResults.find((s) => s.isTotal)?.ms ?? 1)) * 100)}%`}
									></span>
								</span>
								<span class="probe-ms">
									{#if step.detail}<span class="probe-detail">{step.detail}</span>{/if}{step.ms}{i18n(I18nKey.probeUnitMs)}
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="status-detail-empty">{i18n(I18nKey.statusDetailNoData)}</p>
				{/if}
			</div>
		{:else}
			<div class="status-list">
				<div class="status-item">
					<Icon
						{...adminIconProps[adminStatus]}
						class="status-icon {adminStatus === 'checking' ? 'syncing' : adminStatus === 'fail' ? 'error' : 'healthy'}"
					/>
					<div class="status-info">
						<span class="status-label">{i18n(I18nKey.statusAdminService)}</span>
						<span class="status-value">
							<!-- 测试过程中显示当前步骤而非「测试中」，
							     文案长度与最终态接近，状态区高度恒定 -->
							{adminProbeStage
								? adminProbeStage
								: adminStatus === "ok"
									? i18n(I18nKey.statusConnected)
									: adminStatus === "fail"
										? i18n(I18nKey.statusDisconnected)
										: i18n(I18nKey.statusRunning)}
						</span>
						<!-- 步骤指示条：常驻占位但仅测试中可见，
						     非测试时 opacity 0，高度不变，
						     给「正在第几步」一个稳定的视觉锚点 -->
						<span
							class="stage-track"
							class:running={adminStatus === "checking"}
							aria-hidden="true"
						>
							{#each ADMIN_PROBE_STAGES as _, i (i)}
								<span class="stage-seg" class:on={i <= adminProbeStageIndex}></span>
							{/each}
						</span>
					</div>
					<button
						type="button"
						class="connectivity-btn"
						class:is-testing={adminStatus === "checking"}
						onclick={openStatusAction}
						disabled={adminStatus === "checking"}
					>
						{#if adminStatus === "checking"}
							{i18n(I18nKey.statusTesting)}
						{:else if adminProbeDone}
							{i18n(I18nKey.statusViewDetail)}
						{:else}
							{i18n(I18nKey.statusTestConnectivity)}
						{/if}
					</button>
				</div>
				<div class="status-item">
					<Icon
						{...githubIconProps[githubStatus]}
						class="status-icon {githubStatus === 'checking' ? 'syncing' : githubStatus === 'fail' ? 'error' : 'healthy'}"
					/>
					<div class="status-info">
						<span class="status-label">{i18n(I18nKey.statusGithubSync)}</span>
						<span class="status-value">
							{isSyncing
								? i18n(I18nKey.postSyncing)
								: githubStatus === "checking"
									? i18n(I18nKey.statusTesting)
									: githubStatus === "ok"
										? i18n(I18nKey.statusConnected)
										: githubStatus === "fail"
											? i18n(I18nKey.statusDisconnected)
											: i18n(I18nKey.statusReady)}
						</span>
					</div>
					<button
						type="button"
						class="connectivity-btn"
						class:is-testing={githubStatus === "checking"}
						onclick={testConnectivity}
						disabled={isSyncing || githubStatus === "checking"}
					>
						{githubStatus === "checking"
							? i18n(I18nKey.statusTesting)
							: i18n(I18nKey.statusTestConnectivity)}
					</button>
				</div>
				<div class="status-item">
					<Icon icon="material-symbols:article-outline" class="status-icon info" />
					<div class="status-info">
						<span class="status-label">{i18n(I18nKey.dashboardTotalPosts)}</span>
						<span class="status-value">{i18n(I18nKey.dashboardUnit).replace("{count}", String(stats.total))}</span>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet quickActions()}
	<div class="card-base quick-actions">
		<h2>{i18n(I18nKey.quickActions)}</h2>
		<div class="actions-grid">
			<button class="action-card tinted tone-sky" onclick={goCreatePost}>
				<Icon icon="material-symbols:edit-calendar-outline-rounded" class="action-icon" />
				<span>{i18n(I18nKey.adminNewPost)}</span>
			</button>
			<button class="action-card tinted tone-lily" onclick={goPostList}>
				<Icon icon="material-symbols:format-list-bulleted" class="action-icon" />
				<span>{i18n(I18nKey.adminPostList)}</span>
			</button>
			<button class="action-card tinted tone-pond" onclick={() => goSettings()}>
				<Icon icon="material-symbols:settings" class="action-icon" />
				<span>{i18n(I18nKey.adminSettings)}</span>
			</button>
			<button class="action-card tinted tone-wheat" onclick={handleSync} disabled={isSyncing}>
				<Icon icon="material-symbols:cloud" class={isSyncing ? "action-icon syncing" : "action-icon"} />
				<span>{isSyncing ? i18n(I18nKey.postSyncing) : i18n(I18nKey.postSyncNow)}</span>
			</button>
		</div>
	</div>
{/snippet}

{#snippet dashboardHome()}
	<div class="dashboard-home">
		{@render welcomeBanner()}

		<div class="stats-grid">
			{@render statCard(i18n(I18nKey.dashboardTotalPosts), stats.total, "material-symbols:article-outline")}
			{@render statCard(i18n(I18nKey.postPublished), stats.published, "material-symbols:check")}
			{@render statCard(i18n(I18nKey.dashboardDraftBox), stats.drafts, "material-symbols:folder-open-rounded")}
			{@render statCard(i18n(I18nKey.pinned), stats.pinned, "material-symbols:pinboard")}
		</div>

		<div class="dashboard-grid">
			<div class="dashboard-main-col">
				{@render recentPostsSection()}
			</div>
			<div class="dashboard-side-col">
				<!-- {@render contentOverview()} -->
				{@render systemStatus()}
				{@render quickActions()}
			</div>
		</div>
	</div>
{/snippet}

{#if !isVerified}
	<div class="login-loading"></div>
{:else}
	<div class="admin-layout">
		<!-- 移动端侧边栏遮罩 -->
		{#if isSidebarOpen}
			<button
				type="button"
				class="sidebar-backdrop"
				aria-label="关闭菜单"
				tabindex="-1"
				onclick={() => (isSidebarOpen = false)}
			></button>
		{/if}

		<!-- 左侧导航栏 -->
		<aside class="admin-sidebar" class:open={isSidebarOpen} class:collapsed={sidebarCollapsed}>
			<!-- 折叠/展开按钮：悬垂在侧边栏右上角外侧（参考 flare admin-sidebar-toggle） -->
			<button
				class="sidebar-collapse"
				onclick={toggleCollapseSidebar}
				aria-label={i18n(sidebarCollapsed ? I18nKey.adminExpandSidebar : I18nKey.adminCollapseSidebar)}
				title={i18n(sidebarCollapsed ? I18nKey.adminExpandSidebar : I18nKey.adminCollapseSidebar)}
			>
				{#if sidebarCollapsed}
					<Icon icon="material-symbols:menu-open-rounded" />
				{:else}
					<Icon icon="material-symbols:menu-rounded" />
				{/if}
			</button>
			<!-- 品牌区：复用前台导航栏 Logo（siteConfig.navbar.logo），
				   样式与前台一致——图片 28px、mb-1 mr-2、标题 text-md/bold/导航栏字体 -->
				<div class="sidebar-brand" class:brand-follow-theme={logoFollowTheme}>
					{#if logoType === "image"}
						<img src={logoUrl ?? logoValue} alt={logoAlt} class="brand-logo" />
					{:else if logoType === "icon"}
						<Icon icon={logoValue} class="brand-home" />
					{:else}
						<img src={logoValue} alt={logoAlt} class="brand-logo" />
					{/if}
					<span class="brand-title">{siteName}</span>
				</div>

			<nav class="sidebar-nav">
				<!-- 首页 -->
				<button
					class="nav-item"
					class:active={activePage === "dashboard"}
					onclick={goDashboard}
				>
					{#if activePage === "dashboard"}
						<Icon icon="material-symbols:home-rounded" />
					{:else}
						<Icon icon="material-symbols:home-outline-rounded" />
					{/if}
					<span>{i18n(I18nKey.adminHome)}</span>
				</button>

				<!-- 文章管理（直接进列表页；新建入口在列表页头部按钮） -->
				<button
					class="nav-item"
					class:active={activePage === "posts"}
					onclick={goPostList}
				>
					{#if activePage === "posts"}
						<Icon icon="material-symbols:article" />
					{:else}
						<Icon icon="material-symbols:article-outline" />
					{/if}
					<span>{i18n(I18nKey.adminPosts)}</span>
				</button>

				<!-- 分类管理 -->
				<!-- 分类与标签：合并为一个工作台，分类/标签在面板左栏顶部切换 -->
				<button
					class="nav-item"
					class:active={activePage === "categories-and-tags"}
					onclick={goCategoriesAndTags}
				>
					{#if activePage === "categories-and-tags"}
						<Icon icon="material-symbols:folder-rounded" />
					{:else}
						<Icon icon="material-symbols:folder-outline" />
					{/if}
					<span>{i18n(I18nKey.adminCategoriesAndTags)}</span>
				</button>

				<!-- 网站配置：单一入口，不再展开子菜单——
				     具体配置项改由设置页内的 tab + 概览卡片导航 -->
				<button
					class="nav-item"
					class:active={activePage === "settings"}
					onclick={() => goSettings()}
				>
					{#if activePage === "settings"}
						<Icon icon="material-symbols:settings" />
					{:else}
						<Icon icon="material-symbols:settings-outline" />
					{/if}
					<span>{i18n(I18nKey.adminSettings)}</span>
				</button>

				<!-- 环境变量（原用户中心）：从侧栏导航进入，不再由底部用户卡片进入 -->
				<button
					class="nav-item"
					class:active={activePage === "env"}
					onclick={goEnv}
				>
					{#if activePage === "env"}
						<Icon icon="material-symbols:shield-lock" />
					{:else}
						<Icon icon="material-symbols:shield-lock-outline" />
					{/if}
					<span>{i18n(I18nKey.adminEnvVars)}</span>
				</button>

				<!-- 会话管理：原本埋在设置页里，独立成侧栏入口 -->
				<button
					class="nav-item"
					class:active={activePage === "sessions"}
					onclick={goSessions}
				>
					<Icon icon="material-symbols:devices" />
					<span>{i18n(I18nKey.adminSessions)}</span>
				</button>

			</nav>

			<div class="sidebar-footer">
				<!-- 当前管理员信息：纯展示，不可点击、无 hover 效果 -->
				<div class="sidebar-user">
					<span class="user-avatar">
						{#if avatarUrl}
							<img src={avatarUrl} alt="" class="user-avatar-img" />
						{:else}
							<Icon icon="material-symbols:person-rounded" class="user-avatar-fallback" />
						{/if}
					</span>
					<div class="user-meta">
						<span class="user-name">{adminUsername || "admin"}</span>
						<span class="user-role">{i18n(I18nKey.adminSidebarRole)}</span>
					</div>
				</div>
				<!-- 返回前台首页 -->
				<a class="nav-item" href="/">
					<Icon icon="material-symbols:home-outline-rounded" />
					<span>{i18n(I18nKey.adminBackHome)}</span>
				</a>
				<!-- 重新查看新手指引 -->
				{#if isVerified}
					<button class="nav-item" onclick={() => { resetTour(); tourOpen = true; }}>
						<Icon icon="material-symbols:help-outline-rounded" />
						<span>{i18n(I18nKey.adminTourRestart)}</span>
					</button>
				{/if}
				<!-- 深浅模式切换（亮色显示月亮图标，暗色显示太阳图标，点击切换） -->
				<button class="nav-item" onclick={toggleTheme}>
					<Icon
						icon={isDark
							? "material-symbols:wb-sunny-outline-rounded"
							: "material-symbols:dark-mode-outline-rounded"}
					/>
					<span>{i18n(I18nKey.adminToggleTheme)}</span>
				</button>
				<button class="nav-item is-danger" onclick={handleLogout}>
					<Icon icon="material-symbols:arrow-back" />
					<span>{i18n(I18nKey.adminLogout)}</span>
				</button>
			</div>
		</aside>

		<!-- 主内容区 -->
		<div class="admin-main">
			<div class="card-base mobile-topbar">
				<button class="menu-toggle" onclick={() => (isSidebarOpen = true)} aria-label="打开菜单">
					<Icon icon="material-symbols:menu-rounded" />
				</button>
				<h1 class="topbar-title">{headerTitle}</h1>
			</div>

			{#if storageDegraded}
				<div class="storage-degraded" role="status">
					<Icon icon="material-symbols:cloud-off" />
					<span>存储服务暂时不可用，当前为降级模式：后台仍可操作，但「踢下线」等会话管理功能会延迟生效。</span>
				</div>
			{/if}

			<div
			class="admin-content"
			class:content-wide={activePage === "posts" && viewMode !== "list"}
			class:content-fixed={activePage === "settings" ||
				activePage === "env" ||
				activePage === "history" ||
				activePage === "categories-and-tags"}
			style={`--editor-max-page-width: ${editorConfig.maxPageWidth}`}
		>
				{#if activePage === "history" && route.page === "history"}
					<!-- 注入 SPA 导航：历史页返回/恢复后跳编辑器必须走前端路由，
					     用 location.href 会整页重载外壳，比列表页进编辑器慢一个量级 -->
					<PostHistoryPage
						slug={route.slug}
						revisionId={route.revisionId}
						onLeave={() => navigate(`posts/edit/${route.slug}/`)}
					/>
				{:else if activePage === "dashboard"}
					{@render dashboardHome()}
				{:else if activePage === "posts"}
					{#if viewMode === "list"}
						<AdminPage
							title={i18n(I18nKey.adminPosts)}
							intro={i18n(I18nKey.postListCount).replace(
								"{count}",
								String(posts.length),
							)}
						>
							{#snippet actions()}
								<button
									class="ui-btn ui-btn-soft"
									onclick={handleSync}
									disabled={isLoading || isSyncing}
									aria-label={i18n(I18nKey.postSyncNow)}
								>
									<Icon icon="material-symbols:cloud" class="btn-icon" />
									{isSyncing ? i18n(I18nKey.postSyncing) : i18n(I18nKey.postSyncNow)}
								</button>
								<button class="ui-btn ui-btn-primary" onclick={goCreatePost}>
									<Icon icon="material-symbols:add" class="btn-icon" />
									{i18n(I18nKey.adminNewPost)}
								</button>
							{/snippet}
							<PostList
								posts={posts}
								isLoading={isLoading}
								error={error}
								onEdit={handleEditPost}
								onDelete={handleDeleteClick}
								onRefresh={loadPosts}
								onCreate={goCreatePost}
								onSync={handleSync}
								{isSyncing}
								heading={false}
							/>
						</AdminPage>
					{:else if viewMode === "edit" && editingPost}
						<PostEditor
							post={editingPost}
							mode="edit"
							onSave={handleSaveSuccess}
							onCancel={handleCancelEdit}
							onError={(msg) => showToast(msg, "error", 10000)}
						/>
					{:else if viewMode === "create"}
						<PostEditor
							post={null}
							mode="create"
							onSave={handleSaveSuccess}
							onCancel={handleCancelEdit}
							onError={(msg) => showToast(msg, "error", 10000)}
						/>
					{/if}
				{:else if activePage === "settings"}
					<!-- 嵌套结构对齐参考 settings-form-page 的 SettingsSectionFrame：
					     概览页不套工作区外壳（children 直接渲染），
					     详情页才包进 SettingsShell（.settings-workspace.fuwari-card-base） -->
					{#if settingsSection && getConfigItem(settingsSection)}
						<div class="settings-workspace card-base">
							<header class="settings-heading">
								<h1>{i18n(getConfigLabelKey(settingsSection))}</h1>
								<p>{i18n(getConfigDescKey(settingsSection))}</p>
							</header>
							<nav class="settings-tabs" aria-label={i18n(I18nKey.adminSettings)}>
								{#each settingsTabs as tab (tab.id)}
									<button
										type="button"
										class="settings-tab"
										class:active={settingsTab === tab.id}
										aria-current={settingsTab === tab.id ? "page" : undefined}
										onclick={() => goSettingsTab(tab.id)}
									>
										{i18n(tab.labelKey)}
									</button>
								{/each}
							</nav>
							<div class="settings-body">
								{#if settingsRemote}
									<div class="settings-remote-banner">
										<Icon icon="material-symbols:cloud-sync" />
										<span>线上环境：表单基于最近一次构建的配置快照，保存将提交 GitHub 并触发自动重建</span>
									</div>
								{/if}
								<SettingsEditor
									item={getConfigItem(settingsSection)!}
									data={settingsData}
									source={settingsSource}
									error={settingsError}
									isLoading={settingsLoading}
									remote={settingsRemote}
									onUpdate={(v) => (settingsData = v)}
									onModeChange={(m) => (settingsMode = m)}
									onSourceChange={(s) => (settingsSource = s)}
								/>
							</div>
							<footer class="settings-savebar">
								<p>
									{i18n(I18nKey.configFile)
										.replace("{file}", getConfigItem(settingsSection)!.file)
										.replace("{exportName}", getConfigItem(settingsSection)!.exportName ?? "")}
								</p>
								<div>
									<button
										type="button"
										class="settings-action-btn"
										onclick={() => loadSettings(settingsSection)}
										disabled={settingsLoading || settingsSaving}
									>
										<Icon icon="material-symbols:refresh" />
										<span>{i18n(I18nKey.configReload)}</span>
									</button>
									<button
										type="submit"
										class="settings-action-btn primary"
										onclick={saveSettings}
										disabled={settingsSaving || settingsLoading}
									>
										<Icon icon="material-symbols:save-outline" />
										<span>{settingsSaving ? i18n(I18nKey.configSaving) : i18n(I18nKey.configSave)}</span>
									</button>
								</div>
							</footer>
						</div>
					{:else}
						{@render placeholder(i18n(I18nKey.adminSettings), i18n(I18nKey.configSectionUnknown), "material-symbols:settings")}
					{/if}
				{:else if activePage === "404"}
					{@render adminNotFound()}
				{:else if activePage === "categories-and-tags"}
					<AdminPage
						title={i18n(I18nKey.adminCategoriesAndTags)}
						intro={i18n(I18nKey.adminCategoriesIntro)}
					>
						<TaxonomyManager
							kind="category"
							onNotify={(msg, type) => showToast(msg, type)}
						/>
					</AdminPage>
{:else if activePage === "sessions"}
				<AdminPage
					title={i18n(I18nKey.adminSessions)}
					intro={i18n(I18nKey.adminSessionsDesc)}
				>
					<SessionManager onNotify={(msg, type) => showToast(msg, type)} />
				</AdminPage>
			{:else if activePage === "env"}
				<AdminPage title={i18n(I18nKey.adminEnvVars)} intro={i18n(I18nKey.adminEnvVarsIntro)}>
				{#if import.meta.env.PROD}
					<section class="card-base secrets-guide">
						<div class="guide-head">
							<Icon icon="material-symbols:shield-lock" class="guide-icon" />
							<div>
								<h2>{i18n(I18nKey.adminSecretsLocalOnlyTitle)}</h2>
								<p>{i18n(I18nKey.adminSecretsLocalOnlyDesc)}</p>
							</div>
						</div>
						<h3 class="guide-subtitle">{i18n(I18nKey.adminSecretsGuideTitle)}</h3>
						<div class="guide-steps">
							<div class="guide-step">
								<span class="step-num">1</span>
								<p>{i18n(I18nKey.adminSecretsGuideStep1)}</p>
							</div>
							<div class="guide-step">
								<span class="step-num">2</span>
								<p>{i18n(I18nKey.adminSecretsGuideStep2)}</p>
							</div>
							<div class="guide-step">
								<span class="step-num">3</span>
								<p>{i18n(I18nKey.adminSecretsGuideStep3)}</p>
							</div>
						</div>
						<div class="guide-tip">
							<Icon icon="material-symbols:terminal-rounded" />
							<span>{i18n(I18nKey.adminSecretsLocalOnlyTip)}</span>
						</div>
					</section>
				{:else}
					<SecretManager
						onNotify={(message, type, duration) =>
							showToast(message, type, duration)}
						onStateChange={(s) => (secretSaveState = s)}
					/>
				{/if}
				{#snippet footer()}
					{#if secretSaveState?.writable}
						<div class="savebar" role="status">
							{#if secretSaveState.changedCount > 0}
								<button
									class="savebar-notice"
									type="button"
									aria-expanded={dirtyListOpen}
									aria-controls="dirty-list"
									onclick={() => (dirtyListOpen = !dirtyListOpen)}
								>
									<Icon icon="material-symbols:error-outline" />
									<span
										>{i18n(I18nKey.secretsUnsavedCount).replace(
											"{count}",
											String(secretSaveState.changedCount),
										)}</span
									>
									<Icon
										icon={dirtyListOpen
											? "material-symbols:keyboard-arrow-up-rounded"
											: "material-symbols:keyboard-arrow-down-rounded"}
										class="notice-chevron"
									/>
								</button>
							{/if}
							<div class="savebar-actions">
								{#if secretSaveState.changedCount > 0}
									<button
										class="savebar-btn"
										type="button"
										disabled={secretSaveState.saving}
										onclick={() => secretSaveState?.discard()}
									>
										{i18n(I18nKey.secretsDiscard)}
									</button>
								{/if}
								<button
									class="savebar-btn primary"
									type="button"
									onclick={() => secretSaveState?.save()}
									disabled={secretSaveState.saving ||
										secretSaveState.loading ||
										secretSaveState.changedCount === 0}
								>
									<Icon icon="material-symbols:save-outline" />
									<span
										>{secretSaveState.saving
											? i18n(I18nKey.secretsSaving)
											: i18n(I18nKey.secretsSave)}</span
									>
								</button>
							</div>
						</div>
						{#if dirtyListOpen && secretSaveState.changedCount > 0}
							<div class="dirty-list" id="dirty-list">
								{#each secretSaveState.dirtyItems as item (item.key)}
									<button
										class="dirty-item"
										type="button"
										onclick={() => secretSaveState?.scrollToField(item.key)}
									>
										<span class="dirty-item-label">{item.label}</span>
										<span class="dirty-item-hint">
											{i18n(I18nKey.secretsDirtyGoto)}
										</span>
									</button>
								{/each}
							</div>
						{/if}
					{/if}
				{/snippet}
				</AdminPage>
			{/if}
			</div>
		</div>
	</div>

	{#if showDeleteModal && deletingPost}
		<DeleteConfirmModal
			title={deletingPost.title}
			onConfirm={handleConfirmDelete}
			onCancel={() => {
				restoreDeleteFocus(true);
				showDeleteModal = false;
				deletingPost = null;
			}}
		/>
	{/if}

	{#if toast}
		<div class={`toast ${toast.type}`}>
			<Icon
				icon={toast.type === "success" ? "material-symbols:check" : "material-symbols:error-outline"}
				class="text-lg"
			/>
			<span class="toast-message">{toast.message}</span>
			<button class="toast-close" onclick={closeToast} aria-label="关闭通知">
				<Icon icon="material-symbols:close" class="text-sm" />
			</button>
		</div>
	{/if}

	<OnboardingTour
		open={tourOpen}
		onClose={() => (tourOpen = false)}
		onNavigate={(page) => {
			if (page === "secrets") goEnv();
			else if (page === "posts") goPostList();
			else goSettings();
		}}
	/>
{/if}

<!-- 站内切换页面时的未保存确认（对应参考项目 useBlocker 的 resolver 弹窗） -->
{#if leaveConfirmOpen}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.secretsLeaveTitle)}
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) leaveConfirmOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") leaveConfirmOpen = false;
		}}
	>
		<div class="modal-card card-base">
			<div class="modal-head">
				<h3>
					<span>{i18n(I18nKey.secretsLeaveTitle)}</span>
				</h3>
			</div>
			<p class="modal-desc">
				{i18n(I18nKey.secretsLeaveDesc).replace(
					"{count}",
					String(secretSaveState?.changedCount ?? 0),
				)}
			</p>
			<div class="modal-actions">
				<button
					class="savebar-btn primary"
					type="button"
					onclick={() => (leaveConfirmOpen = false)}
				>
					{i18n(I18nKey.secretsLeaveStay)}
				</button>
				<button class="savebar-btn" type="button" onclick={confirmLeave}>
					{i18n(I18nKey.secretsLeaveConfirm)}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- 退出登录二次确认：退出会清掉服务端会话 Cookie，误触代价是重新登录一次，
     所以加一层确认。复用与「未保存确认」相同的 modal 结构。 -->
{#if logoutConfirmOpen}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.adminLogout)}
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) logoutConfirmOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") logoutConfirmOpen = false;
		}}
	>
		<div class="modal-card confirm-card">
			<div class="modal-head">
				<h3>
					<span>{i18n(I18nKey.adminLogout)}</span>
				</h3>
			</div>
			<p class="confirm-message">{i18n(I18nKey.adminLogoutConfirmMessage)}</p>
			<div class="modal-actions">
				<button
					class="savebar-btn"
					type="button"
					onclick={() => (logoutConfirmOpen = false)}
				>
					{i18n(I18nKey.taxonomyCancel)}
				</button>
				<button class="savebar-btn primary" type="button" onclick={performLogout}>
					{i18n(I18nKey.taxonomyConfirm)}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* 后台统一视口高度：给 zoom 容器内部的卡片用。
	   .admin-content 带 zoom，其子元素的高度会被放大，
	   所以这里预先除以 zoom，让卡片渲染后正好等于 (100vh - 3rem)。 */
	.admin-layout {
		/* 基准缩放 1：与参考项目保持一致。参考的 --taxonomy-unit 是
		   clamp(1px, 0.07vw, 1.5px)，在 1080 视口下正好取到 1px，且全程没有额外 zoom；
		   之前这里压到 0.85 会让圆角、行高、间距一并缩掉 15%，视觉上明显更"紧"。
		   只在超宽视口分档放大，且每档的放大幅度都小于视口增幅，保证缩放单调：
		   1500→1900 视口 +27% 对 zoom +9.5%；1900→2400 +26% 对 +13%。 */
		--admin-zoom: 1;
		--admin-viewport-h: calc((100vh - 3rem) / var(--admin-zoom));
		display: flex;
		align-items: stretch;
		gap: 1.25rem;
		/* 必须同时给 height 与 min-height：只给 min-height 时子项会把它
		   继续撑高（仪表板实测比侧栏高 59px）。height 才是硬约束，
		   子项超出的部分由各自的 overflow 处理。 */
		height: calc(100vh - 3rem);
		min-height: 0;
	}

	/* ── 左侧导航栏 ──
	   卡片层级由「背景 + 毛玻璃」表达，不再用实线边框勾勒轮廓；
	   透明边框仅用于占位，保证盒模型与图标列坐标和此前逐像素一致。 */
	.admin-sidebar {
		/* 整页改为文档层滚动后，侧栏用 sticky 常驻视口，
		   高度取视口高（内容超出时自身内部滚动）。 */
		position: sticky;
		top: 1.5rem;
		align-self: flex-start;
		/* 展开态宽度分档：≥1280 用 20rem(320px)，对齐参考项目 .admin-sidebar 的
		   max-width: 20rem；更窄的视口保持 16rem(256px)——实测 1080 视口下 320px
		   会把文章列表的「状态/操作」列挤到换行。折叠态 5.75rem(92px) 两边一致。 */
		width: 16rem;
		flex-shrink: 0;
		height: calc(100vh - 3rem);
		overflow: visible;
		display: flex;
		flex-direction: column;
		/* 侧栏底色：以 card-bg 为基准混入 page-bg（两种模式下 page-bg 都比
		   card-bg 暗），得到稳定「卡片色压暗一档」的结果，明暗两态都落在
		   page-bg 与 card-bg 之间。
		   反例：曾混入 --deep-text，但它在暗色下是亮色(0.95)，会把侧栏抬得
		   比内容区还亮，整条配色梯度倒置。 */
		background: color-mix(in oklab, var(--page-bg) 22%, var(--card-bg));
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		border: 1px solid transparent;
		border-radius: var(--radius-large);
		/* 左右 0.75rem 是折叠态「图标列」的一部分，展开/折叠必须保持一致 */
		padding: 1rem 0.75rem;
		gap: 0.5rem;
		box-shadow: var(--shadow-card);
		/* 展开/收起过渡：与文字淡出共用同一条缓动曲线，避免两段动画节奏不一致 */
		transition:
			width 0.34s cubic-bezier(0.22, 1, 0.36, 1),
			padding 0.34s cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* 品牌区：与前台导航栏 Logo 一致——无 flex gap（图片自带 mb-1 mr-2），
		   悬停出现 btn-plain 背景，标题 text-md/bold/导航栏字体 */
	.sidebar-brand {
		display: flex;
		align-items: center;
		gap: 0;
		/* 上下对称：28px logo（含 mb-1 为 32px margin-box）中心落在
		   品牌盒与右上角折叠按钮（中心 30px）近似同轴，不再上浮。
		   左 1.25rem + logo 14px = 图标中心 46px，与导航图标列对齐；
		   上下 0.5rem：32px + 16px = 48px 行高，与参考项目 3rem 对齐 */
		padding: 0.5rem 0.75rem 0.5rem 1.25rem;
		margin-bottom: 0.75rem;
		border-radius: var(--radius-xl);
		transition: background 0.15s;
		color: var(--deep-text);
	}

	.sidebar-brand:hover {
		background: color-mix(in oklab, var(--primary) 8%, transparent);
	}

	/* 前台 navbar 的 followTheme=true 时 Logo 与标题跟随主题色 */
	.sidebar-brand.brand-follow-theme {
		color: var(--primary);
	}

	/* 前台 Navbar <Picture>：h-7 w-7 mb-1 mr-2 object-contain */
	.brand-logo {
		width: 1.75rem;
		height: 1.75rem;
		margin-bottom: 0.25rem;
		margin-right: 0.5rem;
		object-fit: contain;
		flex-shrink: 0;
	}

	/* 图标型 Logo：与前台 Icon text-[1.75rem] mb-1 mr-2 对齐 */
	.brand-home {
		font-size: 1.75rem;
		flex-shrink: 0;
		margin-bottom: 0.25rem;
		margin-right: 0.5rem;
		/* 颜色继承 brand（深色或主题色），不再是固定的主题色 */
	}

	.brand-title {
		min-width: 0;
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* 后台品牌字号 0.875rem（与参考项目 admin-sidebar-brand 一致）：
		   品牌区可用宽度 162px，0.875rem 下 "EverMemory's Blog" 约 140px，
		   留有余量不会截断 */
		font-family: var(--font-navbar-title, inherit);
		font-size: 0.875rem;
		font-weight: 700;
		color: inherit;
		line-height: 1.45;
		transition:
			opacity 0.18s ease 0.05s,
			transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
			max-width 0.24s cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* 折叠/展开按钮：悬垂在侧边栏右上角外侧。
	   改用卡片底色 + 毛玻璃，与侧栏同材质，避免出现一块白底补丁。 */
	.sidebar-collapse {
		position: absolute;
		top: 1rem;
		right: -0.875rem;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 50%;
		background: color-mix(in oklab, var(--card-bg) 88%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		color: var(--content-meta);
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.sidebar-collapse:hover {
		background: color-mix(in oklab, var(--primary) 14%, transparent);
		color: var(--primary);
	}

	.sidebar-collapse:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	.sidebar-collapse :global(.inline-icon) {
		font-size: 1.125rem;
	}

	.sidebar-nav {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		flex: 1;
		min-height: 0;
		/* 侧栏整体不再滚动（折叠按钮需悬垂出界），滚动需求下沉到导航区 */
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--deep-text) 25%, transparent) transparent;
	}

	.sidebar-nav::-webkit-scrollbar {
		width: 6px;
	}

	.sidebar-nav::-webkit-scrollbar-thumb {
		background: color-mix(in oklab, var(--deep-text) 25%, transparent);
		border-radius: 999px;
	}

	.sidebar-nav::-webkit-scrollbar-track {
		background: transparent;
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.nav-item {
		width: 100%;
		display: flex;
		align-items: center;
		/* 22px：参考项目用 --sidebar-icon-column: 4.25rem(68px) 的网格列，
		   24px 图标居中后右缘到文字正好 22px。之前 10px 明显偏挤。 */
		gap: 1.375rem;
		/* 左内边距固定为页面坐标里的图标列中心：12(侧栏) + 22 + 12 = 46px，
		   与折叠态 92px 的中线一致，因此宽度动画时图标不会横向移动。
		   上下 0.6875rem：图标 24px + 22px = 46px 行高，与参考项目 2.875rem 对齐 */
		padding: 0.6875rem 0.75rem 0.6875rem 1.375rem;
		border: none;
		background: transparent;
		/* 78% 不透明度的主文字色，对齐参考项目 .admin-sidebar-item 的 --fuwari-fg-75。
		   之前直接用 --deep-text（暗色下 oklch 0.95 的近白），深底上对比过强、发刺。
		   用 color-mix 而非 rgba 字面量，明暗两种模式都跟随 --deep-text 自动换算。 */
		color: color-mix(in srgb, var(--deep-text) 78%, transparent);
		/* 保持 14px（0.875rem）不放大：一级项还要容纳展开箭头，
		   240px 侧栏内文字可用仅 160px，而俄文「Управление статьями」
		   需 150px、英文「Post Management」需 122px，提到 15px 会溢出换行 */
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: var(--radius-xl);
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		line-height: 1.3;
		/* 侧边栏内的链接项（返回首页）去除下划线 */
		text-decoration: none;
		/* 展开/收起过渡：padding 随侧栏宽度平滑变化，文字宽/透明度的过渡见下方 span 规则 */
		transition: background 0.15s, color 0.15s, padding 0.25s ease;
	}

	/* 导航图标统一 24px（MD3 drawer leading icon 规范值）。
	   Icon 组件默认 text-base（16px）偏小，这里统一由导航项控制尺寸；
	   一二级不再区分图标大小，层级改由颜色（一级 --deep-text、二级
	   --content-meta）与缩进承担，符合 MD3 同层级图标等宽的约定。 */
	.nav-item :global(.inline-icon) {
		font-size: 1.5rem;
	}

	/* 展开/收起箭头保持 16px：它是状态指示器而非导航图标，
	   过大会与主图标争夺注意力，同时挤占文字宽度 */
	.nav-item :global(.nav-arrow) {
		font-size: 1rem;
	}

	/* 导航文字超宽时折行，不做省略号截断（截断会让用户认不出当前所在项）。
	   min-width: 0 解除 flex 子项的 min-content 锁定，文字才能收缩到容器宽度内换行。
	   :not(.nav-arrow) 排除箭头——Icon 组件渲染的也是 span。 */
	.nav-item > span:not(.nav-arrow) {
		min-width: 0;
		max-width: 100%;
		/* 收起动画期间 max-width 从 100% 过渡到 0，若允许换行，文字会在宽度不够时
		   折成两三行然后被裁一半——看起来像被"挤压"。改成单行 + 裁切后，
		   整个动画过程只会看到文字从右侧被依次截断。 */
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			opacity 0.18s ease 0.05s,
			transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
			max-width 0.24s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.nav-item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 一级导航项选中：主色调高亮（底色 + 文字都取 --primary 系列） */
	.nav-item.active {
		background: color-mix(in oklab, var(--primary) 18%, transparent);
		color: var(--primary);
		font-weight: 600;
	}

	.nav-arrow {
		margin-left: auto;
		flex-shrink: 0;
	}

	/* 悬停/选中统一走 --primary 混色，只改浓度：
	   悬停 8% < 一级选中 18% < 选中悬停 26%，
	   整条梯度单调递增，不会出现「悬停比选中更重」或中性灰与主色混杂。 */
	.nav-item.active:hover {
		background: color-mix(in oklab, var(--primary) 26%, transparent);
	}

	/* 悬停反馈对齐参考 .admin-sidebar-item:hover 的 --fuwari-btn-regular-bg：
	   中性底色，退出登录项也走同一套，不再给单独的红/主色。 */
	.nav-item:hover:not(.active) {
		background: var(--btn-regular-bg);
	}

	/* 底部管理员信息：纯展示，不可点击、无 hover 与选中态 */
	.sidebar-user {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		/* 左 0.875rem + 头像 20px = 中心 46px，与图标列对齐 */
		padding: 0.625rem 0.75rem 0.625rem 0.875rem;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		border-radius: var(--radius-xl);
		margin-bottom: 0.25rem;
	}

	.user-avatar {
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		/* 圆形裁切但无描边：直接展示头像图片 */
		border-radius: 50%;
	}

	.user-avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.user-avatar-fallback {
		font-size: 1.375rem;
		color: var(--content-meta);
	}

	.user-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-width: 100%;
		transition:
			opacity 0.18s ease 0.05s,
			transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
			max-width 0.24s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.user-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--deep-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.4;
	}

	.user-role {
		font-size: 0.75rem;
		color: var(--content-meta);
		line-height: 1.4;
	}

	.sidebar-footer {
		/* 底部结构线用低对比度内容线，不用容器轮廓色 */
		border-top: 1px solid var(--line-color);
		padding-top: 0.5rem;
		margin-top: 0.5rem;
	}

	/* 桌面端折叠模式：仅图标列 */
	@media (min-width: 1024px) {
		.admin-sidebar.collapsed {
			/* 92px = 图标列 4.25rem + 左右各 0.75rem 内边距，与参考项目一致 */
			width: 5.75rem;
			/* 折叠按钮悬垂在右上角外侧，必须关掉滚动裁切才能显示 */
			overflow: visible;
		}

		/* 注意：折叠时不要改动 nav-item / brand / user 的任何水平内边距或
		   justify-content——它们决定图标的 x 坐标。宽度收缩时保持这些值不变，
		   图标才会像参考项目那样停在原地；文字只做淡出 + 宽度收缩。 */

		/* 文字改为淡出 + 左移 + 宽度收缩，而不是 display:none 瞬切：
		   max-width 负责把占位收掉，opacity/transform 负责观感；
		   三者的过渡时长与侧栏宽度动画对齐。 */
		.admin-sidebar.collapsed .nav-item > span:not(.nav-arrow),
		.admin-sidebar.collapsed .brand-title,
		.admin-sidebar.collapsed .user-meta {
			opacity: 0;
			max-width: 0;
			overflow: hidden;
			white-space: nowrap;
			transform: translateX(-0.375rem);
			pointer-events: none;
		}

		/* 折叠态品牌区/导航项/用户卡片不再覆盖任何 padding：
		   上下留白必须与展开态一致，否则收起时每行高度突变，侧栏内容会抽动。
		   折叠只影响宽度与文字可见性。 */

		.admin-sidebar.collapsed .nav-item :global(.nav-arrow) {
			display: none;
		}

	}

	.sidebar-backdrop {
		display: none;
		/* 转成 <button> 后的浏览器默认样式重置 */
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		background: transparent;
	}

	/* ── 主内容区 ── */
	.admin-main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* 移动端 TopBar（对齐参考项目 MobileTopBar：lg:hidden，仅窄屏显示） */
	.mobile-topbar {
		display: none;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		flex-shrink: 0;
		border: none;
		box-shadow: var(--shadow-card);
	}

	.topbar-title {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.menu-toggle {
		display: none;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		cursor: pointer;
		transition: background 0.15s;
	}

	.menu-toggle:hover {
		background: var(--btn-regular-bg-hover);
	}

	/* ── 设置工作区容器：对齐参考 .settings-workspace ──
	   卡片外壳（card-base）+ 纵向 flex；标题/标签/内容/保存栏各占一段。
	   关键：必须有确定高度（height:100% + min-height:0），
	   否则高度被内容撑开，.settings-body 的 flex:1 拿不到可分配空间，
	   overflow-y:auto 失效，滚动会落到外层 .admin-content 上。 */
	/* 设置页工作区：与侧栏等高，滚动交给内部 .settings-body。
	   保存栏因此能常驻底部而不随内容滚走。 */
	.settings-workspace {
		display: flex;
		flex-direction: column;
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		min-height: 0;
		overflow: hidden;
		padding: 0;
	}

	/* 内容区：设置页自己的滚动区域；子项 flex-shrink:0 防压缩。 */
	.settings-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.5rem;
	}

	.settings-body > :global(*) {
		flex-shrink: 0;
	}

	/* ── 设置页 tab 导航：对齐参考 .settings-tabs ──
	   横排、底部 1px 分隔线、当前项主色下划线（2px）；
	   窄屏横向滚动，不换行。位于容器内，左右与内容区对齐。 */
	.settings-tabs {
		display: flex;
		gap: 1.75rem;
		padding: 0 1.75rem;
		border-bottom: 1px solid var(--line-divider);
		overflow-x: auto;
		flex-shrink: 0;
		scrollbar-width: none;
	}

	.settings-tabs::-webkit-scrollbar {
		display: none;
	}

	.settings-tab {
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
		padding: 0.875rem 0.1875rem;
		border: none;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: color-mix(in oklab, var(--deep-text) 75%, transparent);
		font-size: 0.875rem;
		font-family: inherit;
		cursor: pointer;
		transition: color 0.22s, border-color 0.22s;
	}

	.settings-tab:hover {
		color: var(--deep-text);
	}

	.settings-tab.active {
		border-bottom-color: var(--primary);
		color: var(--primary);
	}

	.settings-tab:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}

	/* ── 工作区标题区：对齐参考 settings-heading ──
	   28px/650 标题 + fg-50 灰字简介；位于容器顶部，左右 28px
	   （与 AdminPage 的 .admin-page-heading 同步，对齐参考 workspace 的 28px 内边距）。 */
	.settings-heading {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.75rem 1.75rem 1.25rem;
		flex-shrink: 0;
	}

	.settings-heading h1 {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 650;
		line-height: 1.4;
		color: var(--deep-text);
	}

	.settings-heading p {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--content-meta);
	}

	/* ── 设置保存栏：对齐参考 settings-savebar ──
	   顶部分隔线、左提示右动作、40px 高按钮（10px 圆角）。 */
	.settings-savebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		flex-wrap: wrap;
		padding: 0.875rem 1.5rem;
		border-top: 1px solid var(--line-divider);
		flex-shrink: 0;
	}

	.settings-savebar p {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		min-width: 0;
	}

	.settings-savebar > div {
		display: flex;
		gap: 0.625rem;
		margin-left: auto;
		flex-shrink: 0;
	}

	/* 保存栏按钮：40px 高、10px 圆角（对齐参考 .settings-button） */
	.settings-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 2.5rem;
		padding: 0.5rem 1.125rem;
		border: 1px solid transparent;
		border-radius: 0.625rem;
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.2s ease;
	}

	.settings-action-btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.settings-action-btn.primary {
		background: var(--primary);
		color: var(--page-bg);
	}

	.settings-action-btn.primary:hover:not(:disabled) {
		background: color-mix(in oklab, var(--primary) 88%, var(--page-bg));
	}

	.settings-action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.settings-action-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}

	.search-box {
		/* ui-base 提供 .ui-search 基础形状,这里只保留设置区特有的展开宽度;
		   底色覆盖为 flare 的「内嵌搜索槽」,与前台导航搜索栏区分 */
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		width: 100%;
		max-width: 260px;
	}

	.search-box:hover {
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		border-color: var(--line-color);
	}

	.search-box.focused,
	.search-box:focus-within {
		background: color-mix(in srgb, var(--page-bg) 25%, var(--card-bg));
		box-shadow: 0 0 0 2px var(--btn-regular-bg);
		max-width: 300px;
	}

	.search-box:focus-within :global(.ui-search-icon) {
		color: var(--content-meta);
	}

	/* 存储降级提示条：半透明警告底色 + 低对比边框，不抢内容注意力 */
	.storage-degraded {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-bottom: 0.75rem;
		padding: 0.625rem 1rem;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--warning) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--warning) 22%, transparent);
		color: var(--warning);
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	/* ── 环境变量页保存栏（渲染在 AdminPage footer，位于滚动容器之外）──
	   对齐参考项目 .settings-savebar：容器页脚，靠 border-top 与内容分隔。
	   因为不在滚动容器内，无需 sticky —— 它天然不参与内容滚动。 */
	.savebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		flex-wrap: wrap;
		padding: 0.875rem 1.5rem;
		border-top: 1px solid var(--line-divider);
		background: var(--card-bg);
	}

	/* 提示条：参考项目 .settings-save-notice —— warning 底块 + 圆角 + 中等字重。
	   做成按钮：点击展开未保存改动清单。 */
	.savebar-notice {
		display: inline-flex;
		align-items: center;
		gap: 0.5625rem;
		margin: 0;
		padding: 0.5625rem 0.75rem;
		border: none;
		border-radius: 10px;
		background: color-mix(in oklab, var(--warning) 12%, transparent);
		color: var(--warning);
		font-size: 0.8125rem;
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.savebar-notice:hover {
		background: color-mix(in oklab, var(--warning) 20%, transparent);
	}

	.savebar-notice :global(.inline-icon) {
		flex-shrink: 0;
	}

	.notice-chevron {
		margin-left: 0.125rem;
	}

	/* 未保存改动清单：从 savebar 下方展开，逐项可点击跳转 */
	.dirty-list {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.375rem 1.5rem 0.75rem;
		border-top: 1px solid var(--line-divider);
		background: var(--card-bg);
	}

	.dirty-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.4375rem 0.625rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--deep-text);
		font-size: 0.8125rem;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.dirty-item:hover {
		background: color-mix(in oklab, var(--primary) 10%, transparent);
		color: var(--primary);
	}

	.dirty-item-label {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dirty-item-hint {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.dirty-item:hover .dirty-item-hint {
		color: var(--primary);
	}

	.savebar-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		flex-shrink: 0;
		margin-left: auto;
	}

	/* ── 未保存确认弹窗 ── */
	/* 蒙层：对齐参考项目 .fuwari-modal::backdrop ——
	   rgb(0 0 0 / 0.25) 黑底 + blur(4px)。
	   此前用 color-mix(--deep-text 45%) 是错的：--deep-text 随主题翻转，
	   暗色下是白色，叠出来成了白蒙层。
	   底色固定用黑（蒙层语义就是压暗），不随主题变。 */
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
		max-width: 440px;
		padding: 1.5rem;
		background: var(--float-panel-bg);
		box-shadow: var(--shadow-card);
		border-radius: var(--radius-large);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.modal-head h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
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

	.modal-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.625rem;
	}

	/* 保存栏按钮：与 SecretManager 的 sec-btn 同规格。
	   因 scoped 样式不跨组件，这里需要独立定义一份。 */
	/* 登出确认：按参考 fuwari-confirmation 的 h2 + 说明 + 双按钮结构，
	   宽度取参考的 clamp(420px, 30vw, 520px)；确认按钮用危险色，退出不可逆 */
	.confirm-card {
		width: min(clamp(420px, 30vw, 520px), 92vw);
	}

	.confirm-message {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--content-meta);
	}

	.savebar-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: var(--btn-regular-bg);
		color: var(--btn-content);		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.2s, color 0.2s;
	}

	.savebar-btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.savebar-btn:active:not(:disabled) {
		background: var(--btn-regular-bg-active);
	}

	.savebar-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.savebar-btn.primary {
		background: var(--primary);
		border-color: transparent;
		color: var(--primary-foreground);
		font-weight: 600;
		box-shadow: var(--shadow-button);
	}

	/* 主按钮 hover 显式声明 background，否则会被 .savebar-btn:hover
	   的 --btn-regular-bg-hover 覆盖成浅灰紫（白字几乎不可见） */
	.savebar-btn.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary) 88%, #000);
	}

	.savebar-btn :global(.inline-icon) {
		font-size: 0.875rem;
	}

	.admin-content {
		flex: 1;
		min-width: 0;
		/* 高度由受限的 .admin-layout（height: 100vh-3rem）通过 flex 分配。
		   这里不再写死 calc，避免 zoom 容器内基准不一致。 */
		min-height: 0;
		/* 内容区铺满可用宽度，不再设置 max-width 限制 */
		width: 100%;
		display: flex;
		flex-direction: column;
		/* 与参考项目 --dashboard-unit / --settings-unit 同源的视口自适应，
		   但改为固定分档（见 .admin-layout 的 --admin-zoom）：
		   0.07vw 那种连续计算会与浏览器缩放反向耦合，缩放越小页面反而越大。
		   0.85 解决 1024~1428 窗口里固定 px 显得过大的问题；≥1800 恢复 1，
		   ≥2400 放大到 1.15，让超宽屏不至于过稀。 */
		zoom: var(--admin-zoom);
	}

	/* 分档与 .admin-layout 上的变量定义配套；放这里是因为 zoom 只作用于本元素 */
	/* 展开态宽度分档：与 .admin-sidebar 的 16rem 配套，≥1280 时对齐参考项目的 20rem */
	@media (min-width: 1280px) {
		.admin-sidebar {
			width: 20rem;
		}
	}

	@media (min-width: 1500px) {
		.admin-layout {
			--admin-zoom: 1.05;
		}
	}

	@media (min-width: 1900px) {
		.admin-layout {
			--admin-zoom: 1.15;
		}
	}

	@media (min-width: 2400px) {
		.admin-layout {
			--admin-zoom: 1.3;
		}
	}

	/* 设置详情页：页面本身不滚动，滚动交给内部 .settings-body */
	.admin-content.content-fixed {
		overflow-y: visible;
	}

	/* ── 仪表板首页 ──
	   在限高的 .admin-content 内自己滚动（flex:1 + min-height:0 + auto），
	   而非把外层撑高。 */
	.dashboard-home {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* 欢迎横幅：MD3 primaryContainer 底 + onPrimaryContainer 文字。
	   不使用全色渐变与 glow 光斑——那套高饱和表达与整页的克制色调冲突，
	   且在暗色下会形成大面积高亮块。容器底 + 深色文字对比更稳定，
	   CTA 仍用实心 primary 保持唯一强调项。 */
	.welcome-banner {
		position: relative;
		overflow: hidden;
		background: color-mix(in oklab, var(--primary) 22%, var(--card-bg));
		color: var(--deep-text);
		border-radius: var(--radius-large);
		padding: 1.75rem 2rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
	}

	:global(.dark) .welcome-banner {
		background: color-mix(in oklab, var(--primary) 20%, var(--card-bg));
	}

	.welcome-content {
		position: relative;
		z-index: 1;
	}

	.welcome-greeting {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--content-meta);
		margin-bottom: 0.5rem;
	}

	:global(.welcome-icon) {
		font-size: 1.25rem;
	}

	.welcome-content h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 0.375rem;
	}

	.welcome-content p {
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.welcome-actions {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
	}

	.welcome-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		border: none;
		border-radius: var(--radius-2xl);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.15s;
	}

	/* CTA 用「容器底 + primary 文字」而非「primary 底 + 白字」：
	   --primary 是 oklch(0.70 0.14 275)≈#8696F5，白字压它只有 2.7:1 不可读，
	   而 primary 文字压在近白底上有 3.3:1，够大字号的按钮用。 */
	.welcome-btn.primary {
		background: var(--card-bg);
		color: var(--on-primary-container);
	}

	.welcome-btn.primary:hover {
		background: color-mix(in oklab, var(--primary) 10%, var(--card-bg));
	}

	.welcome-btn.primary:active {
		background: color-mix(in oklab, var(--primary) 28%, var(--card-bg));
	}

	/* 统计卡片 */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
	}

	/* ── 统计卡片 ──
	   底色用 --card-bg 而非色调：前台 .card-base 同为纯 card-bg，
	   浅色下 8% 的 primary 混色几乎看不出卡片边界，且与其它栏目不同色显得突兀。
	   主题色改由 hover state layer 和装饰图标体现。 */
	.stat-card {
		position: relative;
		overflow: hidden;
		min-width: 0;
		padding: 1.25rem 1.25rem 1.75rem;
		border-radius: var(--radius-large);
		background: var(--card-bg);
		transition: background 0.15s;
	}

	/* state layer：悬浮时才浮出淡色调 */
	.stat-card:hover {
		background: color-mix(in oklab, var(--primary) 8%, var(--card-bg));
	}

	.stat-title {
		position: relative;
		z-index: 1;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--deep-text);
	}

	.stat-subtitle {
		position: relative;
		z-index: 1;
		margin-top: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.3;
		color: var(--content-meta);
	}

	/* 装饰图标：右下角、低透明度，悬浮时增强。
	   Icon 为子组件，其根元素需 :global 才能命中本组件 scoped 样式 */
	:global(.stat-deco-icon) {
		position: absolute;
		right: 0.75rem;
		bottom: 0.5rem;
		line-height: 1;
		color: var(--primary);
		opacity: 0.32;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.stat-card:hover :global(.stat-deco-icon) {
		opacity: 0.5;
	}

	/* Dashboard 两栏布局 */
	.dashboard-grid {
		display: grid;
		grid-template-columns: 1.4fr 0.6fr;
		gap: 1rem;
	}

	/* 不做两列等高：右侧系统状态展开分段明细后高度会变化，
	   若左列 flex 撑满就跟着一同拉长，在文章列表下方留下大片空白。
	   各栏按自身内容自然高度排布即可。 */
	.dashboard-main-col,
	.dashboard-side-col {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* 通用 dashboard 卡片 */
	.dashboard-section {
		padding: 1.25rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.section-header h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.section-link {
		font-size: 0.8125rem;
		font-weight: 500;
		/* --primary 是 oklch(0.70 0.14 275)≈#8696F5，压白底仅 2.7:1。
		   前台同类文字链接用 --btn-content（同色相深色版），此处对齐。 */
		color: var(--btn-content);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-md);
		transition: background 0.15s;
		font-family: inherit;
	}

	.section-link:hover {
		background: color-mix(in oklab, var(--primary) 8%, transparent);
	}

	/* 快捷操作：现位于右侧窄栏，故 padding 与标题跟 dashboard-section 对齐 */
	.quick-actions {
		padding: 1.25rem;
	}

	.quick-actions h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 1rem;
	}

	.actions-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	/* 快捷操作 = 放大的前台 .btn-regular：单一中性底色，颜色只留给图标和文字。
	   原先四张卡各有底色（中性 / primary 10% / 三种 tone 彩底），
	   在浅色下形成四块彩色区，抢走了整页的注意力层级。 */
	.action-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		padding: 1.125rem 0.75rem;
		border-radius: var(--radius-2xl);
		background: var(--btn-regular-bg);
		/* 前台 --btn-content(0.55) 压这个底只有 4.3:1，13px 需 4.5；
		   改用同用途且已压深的 --title-active(0.52)，4.89:1。 */
		color: var(--title-active);
		font-size: 0.8125rem;
		font-weight: 400;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
	}

	/* state layer 三档直接复用前台的 btn-regular 三档 token */
	.action-card:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.action-card:active:not(:disabled) {
		background: var(--btn-regular-bg-active);
	}

	.action-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* 四个图标各取莫奈「睡莲池」色板一色，底色与文字保持中性。
	   前台没有「强调卡片」这类概念，故不做主次区分，仅以色相标识功能。 */
	.action-card.tone-sky {
		--tone: var(--monet-sky);
	}

	.action-card.tone-lily {
		--tone: var(--monet-lily);
	}

	.action-card.tone-pond {
		--tone: var(--monet-pond);
	}

	.action-card.tone-wheat {
		--tone: var(--monet-wheat);
	}

	.action-card.tinted :global(.action-icon) {
		color: var(--tone);
		opacity: 1;
	}

	:global(.action-icon) {
		font-size: 1.5rem;
		opacity: 0.8;
	}

	/* 同步进行中：图标脉冲提示 */
	:global(.action-icon.syncing) {
		animation: pulse-soft 1.5s ease-in-out infinite;
		opacity: 1;
	}

	@keyframes pulse-soft {
		0%, 100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.05);
			opacity: 0.85;
		}
	}

	/* 最近文章 */
	.post-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.post-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem 0.75rem;
		border: none;
		border-radius: var(--radius-lg);
		background: transparent;
		color: inherit;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s;
	}

	.post-item:hover {
		background: var(--btn-regular-bg);
	}

	.post-item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}

	.post-status-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.post-status-dot[data-draft="false"] {
		background: var(--success);
	}

	.post-status-dot[data-draft="true"] {
		background: var(--warning);
	}

	.post-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.post-title {
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--deep-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.post-meta {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	:global(.post-arrow) {
		color: var(--content-meta);
		opacity: 0.5;
		flex-shrink: 0;
		font-size: 1.125rem;
	}

	/* 空状态 */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2.5rem 1rem;
		text-align: center;
	}

	:global(.empty-icon) {
		font-size: 2.5rem;
		color: var(--content-meta);
		opacity: 0.6;
	}

	.empty-state p {
		font-size: 0.875rem;
		color: var(--content-meta);
	}

/* 暂不使用：内容概览样式（随 contentOverview 一并注释） */
	/* overview-chart { */
	/* display: flex; */
	/* align-items: center; */
	/* gap: 1.25rem; */
	/* padding: 0.5rem 0; */
	/* } */
	/* .chart-ring { */
		/* position: relative; */
		/* width: 6.5rem; */
		/* height: 6.5rem; */
		/* flex-shrink: 0; */
	/* } */
	/* .ring-svg { */
		/* width: 100%; */
		/* height: 100%; */
		/* transform: rotate(-90deg); */
	/* } */
	/* .ring-bg { */
		/* fill: none; */
		/* stroke: var(--line-divider); */
		/* stroke-width: 3; */
	/* } */
	/* .ring-fill { */
		/* fill: none; */
		/* stroke-width: 3; */
		/* stroke-linecap: round; */
		/* transition: stroke-dasharray 0.6s ease; */
	/* } */
	/* .ring-fill.published { */
		/* stroke: var(--success); */
	/* } */
	/* .ring-label { */
		/* position: absolute; */
		/* inset: 0; */
		/* display: flex; */
		/* flex-direction: column; */
		/* align-items: center; */
		/* justify-content: center; */
	/* } */
	/* .ring-value { */
		/* font-size: 1.25rem; */
		/* font-weight: 700; */
		/* color: var(--deep-text); */
	/* } */
	/* .ring-caption { */
		/* font-size: 0.6875rem; */
		/* color: var(--content-meta); */
	/* } */
	/* .chart-legend { */
		/* flex: 1; */
		/* display: flex; */
		/* flex-direction: column; */
		/* gap: 0.625rem; */
	/* } */
	/* .legend-item { */
		/* display: flex; */
		/* align-items: center; */
		/* gap: 0.5rem; */
		/* font-size: 0.875rem; */
	/* } */
	/* .legend-dot { */
		/* width: 0.5rem; */
		/* height: 0.5rem; */
		/* border-radius: 50%; */
		/* flex-shrink: 0; */
	/* } */
	/* .legend-dot.published { */
		/* background: var(--success); */
	/* } */
	/* .legend-dot.draft { */
		/* background: var(--warning); */
	/* } */
	/* .legend-dot.pinned { */
		/* background: var(--primary); */
	/* } */
	/* .legend-label { */
		/* color: var(--content-meta); */
	/* } */
	/* .legend-count { */
		/* margin-left: auto; */
		/* font-weight: 600; */
		/* color: var(--deep-text); */
	/* } */
/*  */

/* 系统状态 */
	.status-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.status-item {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.875rem;
		padding: 0.625rem 0.5rem;
		border-radius: var(--radius-lg);
		transition: background 0.15s;
	}

	.status-item:hover {
		background: var(--btn-regular-bg);
	}

	:global(.status-icon) {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	:global(.status-icon.healthy) {
		color: var(--success);
	}

	:global(.status-icon.syncing) {
		color: var(--primary);
		animation: spin 1.5s linear infinite;
	}

	:global(.status-icon.info) {
		color: var(--primary);
	}

	:global(.status-icon.error) {
		color: var(--destructive);
	}

	.status-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.status-label {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	/* 分段探测明细：只存在于内嵌详情视图内，卡片默认视图不再撑高 */
	.probe-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.25rem 0 0.25rem 2.375rem;
	}

	/* 步骤指示条：常驻占位，仅测试中点亮。
	   高度固定 3px，非测试时透明，故测试开始/结束都不会改变状态行高度。 */
	.stage-track {
		display: flex;
		gap: 3px;
		height: 3px;
		margin-top: 2px;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.stage-track.running {
		opacity: 1;
	}

	.stage-seg {
		flex: 1;
		min-width: 0;
		border-radius: 9999px;
		/* 进度条轨道：装饰/占位，用 --muted */
		background: var(--muted);
		transition: background-color 0.2s ease;
	}

	.stage-seg.on {
		background: var(--primary);
	}

	/* 详情视图容器：与默认状态列表同级切换 */
	.status-detail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.status-detail-head {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.625rem 0.5rem;
		border-radius: var(--radius-lg);
		background: var(--btn-regular-bg);
	}

	.status-detail-empty {
		font-size: 0.8125rem;
		color: var(--content-meta);
		text-align: center;
		padding: 1.25rem 0.5rem;
	}

	.probe-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		animation: probe-in 0.15s ease-out;
	}

	/* 各阶段占总耗时的比例条，直观看出瓶颈在哪一段 */
	.probe-bar {
		flex: 1;
		height: 0.25rem;
		border-radius: 9999px;
		background: var(--btn-regular-bg);
		overflow: hidden;
	}

	.probe-bar-fill {
		display: block;
		height: 100%;
		border-radius: 9999px;
		background: color-mix(in oklab, var(--primary) 55%, var(--btn-regular-bg));
	}

	.probe-row.total .probe-label,
	.probe-row.total .probe-ms {
		font-weight: 600;
		color: var(--deep-text);
	}

	@keyframes probe-in {
		from {
			opacity: 0;
			transform: translateY(-2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.probe-label {
		color: var(--content-meta);
	}

	.probe-ms {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		color: var(--content-meta);
	}

	.probe-detail {
		margin-right: 0.375rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		opacity: 0.75;
	}

	.status-value {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.connectivity-btn {
		flex-shrink: 0;
		margin-left: auto;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1;
		padding: 0.375rem 0.75rem;
		border-radius: 10px;
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		border: 1px solid var(--line-divider);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}

	.connectivity-btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
		border-color: var(--line-color);
	}

	/* 测试中：按钮内左侧圆环旋转，让过程不只体现在文字变化上 */
	.connectivity-btn.is-testing::before {
		content: "";
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		margin-right: 0.375rem;
		vertical-align: -0.125rem;
		border: 2px solid color-mix(in oklab, var(--deep-text) 25%, transparent);
		border-top-color: var(--deep-text);
		border-radius: 50%;
		animation: connectivity-spin 0.7s linear infinite;
	}

	@keyframes connectivity-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.connectivity-btn.is-testing::before {
			animation-duration: 1.6s;
		}
	}

	.connectivity-btn:active:not(:disabled) {
		background: var(--btn-regular-bg-active);
	}

	.connectivity-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── 后台 404：沿用前台 404.astro 的入场动画与按钮悬停 ──
	   前台按钮阴影写的是 rgba(var(--primary-rgb), .3)，而项目未定义
	   --primary-rgb（该声明实际无效），此处改用现成的 --shadow-md。 */
	/* 404 图标尺寸：前台用 text-6xl / text-4xl，但本项目 Icon 组件内部
	   固定带 text-base，会盖掉传入的 text-*，故按既有做法用 :global()
	   显式声明字号（3.75rem = 60px / 2.25rem = 36px，与前台一致）。 */
	:global(.notfound-404-icon) {
		font-size: 3.75rem;
		color: var(--primary);
	}

	:global(.notfound-404-deco) {
		font-size: 2.25rem;
		color: var(--primary);
	}

	.notfound-card {
		animation: fadeInUp 0.6s ease-out;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}

		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.notfound-back {
		transition: background-color 0.2s ease, box-shadow 0.2s ease;
	}

	/* hover 只提亮阴影，不做位移：后台固定布局里按钮位置须稳定 */
	.notfound-back:hover {
		box-shadow: var(--shadow-md);
	}

	/* ── 占位页（首页 / 网站配置，待后续实现） ── */
	.placeholder-page {
		padding: 3.5rem 2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.placeholder-icon {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		background: color-mix(in oklab, var(--primary) 12%, transparent);
		color: var(--primary);
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.25rem;
	}

	.placeholder-page h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.placeholder-page p {
		font-size: 0.875rem;
		color: var(--content-meta);
		max-width: 28rem;
		line-height: 1.6;
	}

	.placeholder-badge {
		margin-top: 0.5rem;
		padding: 0.25rem 0.875rem;
		border-radius: 999px;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.75rem;
	}

	/* ── Toast ── */
	.toast {
		position: fixed;
		top: 5rem;
		right: 2rem;
		padding: 0.75rem 1.25rem;
		border-radius: var(--radius-lg);
		color: white;
		font-weight: 500;
		box-shadow: var(--shadow-lg);
		animation: slideIn 0.3s ease-out;
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		backdrop-filter: blur(8px);
	}

	.toast.success {
		background: color-mix(in oklab, var(--success) 92%, transparent);
	}

	.toast.error {
		background: color-mix(in oklab, var(--destructive) 92%, transparent);
	}

	.toast-message {
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}

	.toast-close {
		background: rgba(255, 255, 255, 0.2);
		border: none;
		border-radius: 50%;
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: white;
		padding: 0;
		flex-shrink: 0;
		transition: background 0.15s;
	}

	.toast-close:hover {
		background: rgba(255, 255, 255, 0.4);
	}

	.toast-close:focus {
		outline: 2px solid white;
		outline-offset: 2px;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	/* ── 响应式 ── */
	@media (max-width: 1023px) {
		.mobile-topbar {
			display: flex;
		}

		.admin-sidebar {
			position: fixed;
			top: 1rem;
			left: 1rem;
			bottom: 1rem;
			/* 浮层抽屉：78vw 但不超过 20rem，四周留 1rem 露出背景 */
			width: 78vw;
			max-width: 20rem;
			height: auto;
			z-index: 120;
			/* 与桌面态同材质：无实线边框，靠背景/毛玻璃/阴影分层 */
			border: 1px solid transparent;
			border-radius: var(--radius-large);
			transform: translateX(calc(-100% - 1rem));
			transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
		}

		.admin-sidebar.open {
			transform: translateX(0);
			box-shadow: var(--shadow-lg);
		}

		.sidebar-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: color-mix(in oklab, var(--deep-text) 20%, transparent);
			-webkit-backdrop-filter: blur(4px);
			backdrop-filter: blur(4px);
			z-index: 110;
		}

		.menu-toggle {
			display: inline-flex;
		}
	}

	@media (max-width: 1023px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.dashboard-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 768px) {
		/* 搜索框窄屏全宽（设置索引页头内自动换行） */
		.search-box {
			max-width: none;
			width: 100%;
		}

		.search-box:focus-within {
			max-width: none;
		}

		.toast {
			top: 5rem;
			right: 1rem;
			left: auto;
			max-width: min(90vw, 22rem);
		}

		.placeholder-page {
			padding: 2.5rem 1.25rem;
		}

		.welcome-banner {
			flex-direction: column;
			align-items: flex-start;
			padding: 1.5rem;
		}

		.welcome-content h2 {
			font-size: 1.25rem;
		}

		.welcome-actions {
			width: 100%;
		}

		.welcome-btn.primary {
			width: 100%;
			justify-content: center;
		}

		.stats-grid {
			grid-template-columns: 1fr;
		}

		.actions-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		/* .overview-chart {
			flex-direction: column;
			align-items: flex-start;
		} */
	}
	/* 生产环境提示卡片 */
	.secrets-guide {
		padding: 1.75rem;
	}

	.settings-remote-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--content-meta);
		background: color-mix(in oklab, var(--primary) 8%, transparent);
		border: 1px solid color-mix(in oklab, var(--primary) 25%, transparent);
	}

	.settings-remote-banner :global(.icon) {
		flex-shrink: 0;
		color: var(--primary);
	}

	.guide-head {
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
		margin-bottom: 1.25rem;
	}

	:global(.guide-icon) {
		flex-shrink: 0;
		margin-top: 0.25rem;
		color: var(--primary);
	}

	.guide-head h2 {
		font-size: 1.1875rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.375rem;
	}

	.guide-head p {
		font-size: 0.875rem;
		color: var(--content-meta);
		line-height: 1.7;
	}

	.guide-subtitle {
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.875rem;
	}

	.guide-steps {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.guide-step {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		background: rgba(128, 128, 128, 0.06);
		border-radius: var(--radius-md);
		padding: 0.75rem 0.875rem;
	}

	.step-num {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--primary);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.guide-step p {
		font-size: 0.875rem;
		color: var(--deep-text);
		line-height: 1.7;
	}

	.guide-tip {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.6;
		background: color-mix(in srgb, var(--info) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--info) 25%, transparent);
		border-radius: var(--radius-sm);
		padding: 0.625rem 0.875rem;
	}

	.guide-tip :global(svg) {
		flex-shrink: 0;
		margin-top: 0.125rem;
		color: var(--info);
	}
</style>
