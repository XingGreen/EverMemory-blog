<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { probeAdminService, runProbeWithStages } from "@/utils/admin-probe";
import {
	CONFIG_GROUPS,
	CONFIG_ITEMS,
	getConfigDescKey,
	getConfigGroup,
	getConfigItem,
	getConfigLabelKey,
} from "@/utils/admin-settings";
import { isTourDone, resetTour } from "@/utils/onboarding";
import DeleteConfirmModal from "./DeleteConfirmModal.svelte";
import OnboardingTour from "./OnboardingTour.svelte";
import PostEditor from "./PostEditor.svelte";
import PostList from "./PostList.svelte";
import SecretManager from "./SecretManager.svelte";
import SessionManager from "./SessionManager.svelte";
import SettingsEditor from "./SettingsEditor.svelte";
import SettingsOverview from "./SettingsOverview.svelte";
import VerifyScreen from "./VerifyScreen.svelte";

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
type Page = "dashboard" | "posts" | "settings" | "secrets" | "sessions";

// 基于 URL 路径的真实路由（History API）：
//   /admin/dashboard/                      → 首页
//   /admin/dashboard/articles/             → 文章列表
//   /admin/dashboard/articles/new/         → 新建文章
//   /admin/dashboard/articles/edit/:slug/  → 编辑文章
//   /admin/dashboard/settings/             → 网站配置（概览）
//   /admin/dashboard/settings/:key/        → 网站配置（具体配置文件子页）
type Route =
	| { page: "login" }
	| { page: "dashboard" }
	| { page: "posts" }
	| { page: "create" }
	| { page: "edit"; slug: string }
	| { page: "settings"; section?: string }
	| { page: "secrets" }
	| { page: "sessions" };

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
let settingsSearchTerm = $state("");
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
let settingsSubOpen = $state(true); // 网站配置子菜单是否展开
let isSidebarOpen = $state(false); // 移动端侧边栏抽屉是否打开
let sidebarCollapsed = $state(false); // 桌面端侧边栏是否折叠（仅图标模式）

if (typeof window !== "undefined") {
	const savedCollapsed = localStorage.getItem("admin-sidebar-collapsed");
	if (savedCollapsed === "true") sidebarCollapsed = true;
}

// 折叠/展开侧边栏：折叠时自动收起所有子菜单，仅保留图标，悬停图标滑出二级菜单
function toggleCollapseSidebar() {
	sidebarCollapsed = !sidebarCollapsed;
	if (sidebarCollapsed) {
		settingsSubOpen = false;
	}
	localStorage.setItem("admin-sidebar-collapsed", String(sidebarCollapsed));
}

// 折叠态点击带二级菜单的项：钉住悬浮浮层（flyout-pinned）。
// 钉住后浮层不再依赖 hover，鼠标移出也保持显示，直到用户点击页面
// 空白处（onWindowClick）或从浮层内选择了配置项才解除。
let flyoutPinned = $state(false);

function handleSettingsHeadClick() {
	if (sidebarCollapsed) {
		flyoutPinned = !flyoutPinned;
		return;
	}
	toggleSettingsSubmenu();
}

// 钉住状态下点击空白处解除：浮层内（按钮/面板）的点击不处理，
// 避免选择路径上的点击误关闭面板
function onWindowClick(e: MouseEvent) {
	if (!flyoutPinned) return;
	const target = e.target as Element | null;
	if (target?.closest(".settings-flyout-wrap")) return;
	flyoutPinned = false;
}

const activePage = $derived<Page>(
	route.page === "dashboard"
		? "dashboard"
		: route.page === "settings"
			? "settings"
			: route.page === "secrets"
				? "secrets"
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
	const rest = pathname.replace(/^\/admin\/dashboard\/?/, "");
	// 不在后台前缀下视为未知路由，回落到登录态判定
	if (rest === pathname) return { page: "login" };
	const segments = rest.split("/").filter(Boolean);
	switch (segments[0]) {
		case undefined:
			return { page: "dashboard" };
		case "articles":
			if (segments[1] === "new") return { page: "create" };
			if (segments[1] === "edit" && segments[2])
				return { page: "edit", slug: segments[2] };
			return { page: "posts" };
		case "settings": {
			// 仅接受已知配置项作为子页，否则回落到配置概览
			const section =
				segments[1] && CONFIG_ITEMS.some((item) => item.key === segments[1])
					? segments[1]
					: undefined;
			return { page: "settings", section };
		}
		case "secrets":
			return { page: "secrets" };
		case "sessions":
			return { page: "sessions" };
		default:
			// 未知路由：返回登录态判定，由 applyRoute 决定去向
			return { page: "login" };
	}
}

function applyRoute() {
	// 未登录：跳回独立登录页（/admin/），不再在后台页内展示登录
	if (!isVerified) {
		route = { page: "login" };
		window.location.replace("/admin/");
		return;
	}
	const next = parseRoute(window.location.pathname);
	// 已登录用户落在未知路由时，回落到控制面板首页（保持地址不变）
	route = next.page === "login" ? { page: "dashboard" } : next;
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
	// 侧边栏底部用户卡片展示的管理员用户名（与会话接口同一来源）
	try {
		const res = await fetch("/api/admin/session/");
		const data = await res.json();
		if (typeof data.username === "string" && data.username) {
			adminUsername = data.username;
		}
	} catch {
		// 网络异常时保留空值，登录后再补
	}
	if (!isVerified) {
		// 未登录访问后台页：先尝试"记住我"Cookie，有效则免登录进入
		try {
			const res = await fetch("/api/admin/session/");
			const data = await res.json();
			if (data.success) {
				isVerified = true;
				sessionStorage.setItem("admin_verified", "true");
				startAdmin();
				return;
			}
		} catch {
			// 网络异常时按未登录处理
		}
		// 记住想进入的地址，跳回独立登录页，登录后跳回原目标
		sessionStorage.setItem("admin_redirect", window.location.pathname);
		window.location.replace("/admin/");
		return;
	}
	startAdmin();
});

// 移动端 TopBar 标题随页面联动（桌面端已无全局 header）
const headerTitle = $derived.by(() => {
	if (activePage === "dashboard") return i18n(I18nKey.adminDashboard);
	if (activePage === "settings") {
		const item = settingsSection ? getConfigItem(settingsSection) : undefined;
		return item
			? i18n(getConfigLabelKey(item.key))
			: i18n(I18nKey.adminSettings);
	}
	if (activePage === "secrets") return i18n(I18nKey.adminSecrets);
	if (activePage === "sessions") return i18n(I18nKey.adminSessions);
	if (viewMode === "edit" && editingPost) return i18n(I18nKey.adminEditPost);
	if (viewMode === "create") return i18n(I18nKey.adminNewPost);
	return i18n(I18nKey.adminPosts);
});

async function loadPosts() {
	isLoading = true;
	error = "";
	try {
		const response = await fetch("/api/admin/posts/");
		const data = await response.json();
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
		// 运行时配置（可视化表单）：写入 KV 覆盖层，即时生效、不触发重建
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

function handleVerify(success: boolean) {
	if (success) {
		isVerified = true;
		sessionStorage.setItem("admin_verified", "true");
		loadPosts();
		showToast("验证成功", "success");
		goDashboard();
		// 登录成功后补齐侧边栏用户卡片的管理员用户名
		fetch("/api/admin/session/")
			.then((res) => res.json())
			.then((data) => {
				if (typeof data.username === "string" && data.username) {
					adminUsername = data.username;
				}
			})
			.catch(() => {
				// 忽略
			});
	} else {
		showToast("密码验证失败", "error");
	}
}

async function handleLogout() {
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
	window.location.replace("/admin/");
}

// ── 导航（History API 真实路径路由） ──
const DASHBOARD_PATH = "/admin/dashboard/";

function navigate(path: string) {
	isSidebarOpen = false;
	if (window.location.pathname === path) {
		applyRoute();
		return;
	}
	history.pushState({}, "", path);
	applyRoute();
}

function goDashboard() {
	navigate(DASHBOARD_PATH);
}

function goSettings(section?: string) {
	// 从折叠态浮层选择配置项后解除钉住
	flyoutPinned = false;
	navigate(
		section
			? `${DASHBOARD_PATH}settings/${section}/`
			: `${DASHBOARD_PATH}settings/`,
	);
}

function goSecrets() {
	navigate(`${DASHBOARD_PATH}secrets/`);
}

function goSessions() {
	navigate(`${DASHBOARD_PATH}sessions/`);
}

function toggleSettingsSubmenu() {
	// 折叠态下组头仅作为 hover 滑出触发点，不允许内联展开
	if (sidebarCollapsed) return;
	settingsSubOpen = !settingsSubOpen;
}

function goPostList() {
	navigate(`${DASHBOARD_PATH}articles/`);
}

function goCreatePost() {
	navigate(`${DASHBOARD_PATH}articles/new/`);
}

function goEditPost(post: Post) {
	navigate(`${DASHBOARD_PATH}articles/edit/${post.slug}/`);
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

<svelte:window onclick={onWindowClick} />

{#if !isVerified}
	<VerifyScreen onVerify={handleVerify} {avatarUrl} />
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

				<!-- 网站配置：展开态点击切换子菜单；折叠态悬停图标 → 右侧浮层预览配置列表 -->
				<div class="settings-flyout-wrap" class:open={settingsSubOpen} class:flyout-pinned={flyoutPinned}>
					<button
						class="nav-item nav-group-head"
						class:group-active={activePage === "settings"}
						class:flyout-pinned={flyoutPinned}
						onclick={handleSettingsHeadClick}
						aria-expanded={settingsSubOpen}
					>
{#if activePage === "settings"}
						<Icon icon="material-symbols:settings" />
					{:else}
						<Icon icon="material-symbols:settings-outline" />
					{/if}
					<span>{i18n(I18nKey.adminSettings)}</span>
						{#if !sidebarCollapsed}
							<Icon
								icon={settingsSubOpen ? "material-symbols:keyboard-arrow-up-rounded" : "material-symbols:keyboard-arrow-down-rounded"}
								class="nav-arrow"
							/>
						{/if}
					</button>
					<div class="flyout-panel" aria-hidden={!sidebarCollapsed}>
						<div class="nav-submenu">
							<button
								class="nav-item sub"
								class:active={activePage === "settings" && !settingsSection}
								onclick={() => goSettings()}
							>
								{#if activePage === "settings" && !settingsSection}
									<Icon icon="material-symbols:extension-rounded" />
								{:else}
									<Icon icon="material-symbols:extension-outline" />
								{/if}
								<span>{i18n(I18nKey.adminSettingsOverview)}</span>
							</button>
							{#each CONFIG_GROUPS as group}
							{@const groupItems = CONFIG_ITEMS.filter(
								(item) => getConfigGroup(item.key) === group.id,
							)}
							{#if groupItems.length > 0}
								<div class="nav-group-label">{i18n(group.labelKey)}</div>
								{#each groupItems as item (item.key)}
									{@const itemActive =
										activePage === "settings" && settingsSection === item.key}
									<button
										class="nav-item sub"
										class:active={itemActive}
										onclick={() => goSettings(item.key)}
									>
										<Icon icon={itemActive ? item.icon : item.iconOutline} />
										<span>{i18n(getConfigLabelKey(item.key))}</span>
									</button>
								{/each}
							{/if}
						{/each}
						</div>
					</div>
				</div>

				<!-- 密钥配置 -->
				<button
					class="nav-item"
					class:active={activePage === "secrets"}
					onclick={goSecrets}
				>
					{#if activePage === "secrets"}
					<Icon icon="material-symbols:shield-lock" />
				{:else}
					<Icon icon="material-symbols:shield-lock-outline" />
				{/if}
				<span>{i18n(I18nKey.adminSecrets)}</span>
				</button>

				<!-- 会话管理 -->
				<button
					class="nav-item"
					class:active={activePage === "sessions"}
					onclick={goSessions}
				>
					{#if activePage === "sessions"}
					<Icon icon="material-symbols:devices" />
				{:else}
					<Icon icon="material-symbols:devices-outline" />
				{/if}
				<span>{i18n(I18nKey.adminSessions)}</span>
				</button>
			</nav>

			<div class="sidebar-footer">
				<!-- 当前管理员：左侧头像 + 用户名（登录/记住我 Cookie 回填）+ 角色 -->
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
				<button class="nav-item" onclick={handleLogout}>
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

			<div
			class="admin-content"
			class:content-wide={activePage === "posts" && viewMode !== "list"}
			style={`--editor-max-page-width: ${editorConfig.maxPageWidth}`}
		>
				{#if activePage === "dashboard"}
					{@render dashboardHome()}
				{:else if activePage === "posts"}
					{#if viewMode === "list"}
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
						/>
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
					{#if settingsSection}
						{#if getConfigItem(settingsSection)}
							{#if settingsRemote}
								<div class="settings-remote-banner">
									<Icon icon="material-symbols:cloud-sync" />
									<span>线上环境：表单基于最近一次构建的配置快照，保存将提交 GitHub 并触发自动重建</span>
								</div>
							{/if}
							<div class="card-base settings-page-head">
								<h2 class="page-head-title">{i18n(getConfigLabelKey(settingsSection))}</h2>
								<div class="page-head-actions">
									<button
										class="page-head-btn"
										onclick={() => loadSettings(settingsSection)}
										disabled={settingsLoading}
									>
										<Icon icon="material-symbols:refresh" class="text-sm" />
										<span>{i18n(I18nKey.configReload)}</span>
									</button>
									<button
										class="page-head-btn primary"
										onclick={saveSettings}
										disabled={settingsSaving || settingsLoading}
									>
										<Icon icon="material-symbols:save-outline" class="text-sm" />
										<span>{settingsSaving ? i18n(I18nKey.configSaving) : i18n(I18nKey.configSave)}</span>
									</button>
								</div>
							</div>
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
						{:else}
							{@render placeholder(i18n(I18nKey.adminSettings), i18n(I18nKey.configSectionUnknown), "material-symbols:settings")}
						{/if}
					{:else}
						<div class="card-base settings-overview-head">
							<h2 class="overview-title">{i18n(I18nKey.adminSettings)}</h2>
							<div class="ui-search search-box" class:focused={settingsSearchTerm.length > 0}>
								<Icon icon="material-symbols:search" class="ui-search-icon" size="lg" />
								<input
									type="text"
									bind:value={settingsSearchTerm}
									placeholder="{i18n(I18nKey.search)}..."
									class="ui-search-input"
									aria-label={i18n(I18nKey.search)}
								/>
								{#if settingsSearchTerm}
									<button class="ui-search-clear" onclick={() => (settingsSearchTerm = "")} aria-label="清除">
										<Icon icon="material-symbols:close" size="sm" />
									</button>
								{/if}
							</div>
						</div>
						<SettingsOverview
							onNavigate={(key) => goSettings(key)}
							searchTerm={settingsSearchTerm}
							onSearchChange={(value) => (settingsSearchTerm = value)}
						/>
					{/if}
{:else if activePage === "secrets"}
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
					/>
				{/if}
			{:else if activePage === "sessions"}
				<SessionManager
					onNotify={(message, type, duration) =>
						showToast(message, type, duration)}
				/>
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
			if (page === "secrets") goSecrets();
			else if (page === "posts") goPostList();
			else goSettings();
		}}
	/>
{/if}

<style>
	.admin-layout {
		display: flex;
		align-items: stretch;
		gap: 1.25rem;
		/* 让后台内容区始终限制在人眼可视范围（扣除 .admin-container 上下内边距），
		   侧边栏与右侧内容区各自内部滚动，不再让整页滚动 */
		height: calc(100vh - 3rem);
		min-height: 0;
	}

	/* ── 左侧导航栏 ── */
	.admin-sidebar {
		/* position/overflow：折叠按钮悬垂在右上角外侧，滚动裁切必须放开，
		   滚动需求交给内部 .sidebar-nav */
		position: relative;
		width: 240px;
		flex-shrink: 0;
		height: 100%;
		overflow: visible;
		display: flex;
		flex-direction: column;
		background: var(--admin-sidebar-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		padding: 1rem;
		gap: 0.5rem;
		box-shadow: var(--shadow-card);
	}

	/* 品牌区：与前台导航栏 Logo 一致——无 flex gap（图片自带 mb-1 mr-2），
		   悬停出现 btn-plain 背景，标题 text-md/bold/导航栏字体 */
	.sidebar-brand {
		display: flex;
		align-items: center;
		gap: 0;
		/* 上下对称：28px logo（含 mb-1 为 32px margin-box）中心落在
		   品牌盒与右上角折叠按钮（中心 30px）近似同轴，不再上浮 */
		padding: 0.75rem 1.5rem 0.75rem 0;
		border-bottom: 1px solid var(--line-divider);
		margin-bottom: 0.75rem;
		border-radius: var(--radius-lg);
		transition: background 0.15s;
		color: var(--deep-text);
	}

	.sidebar-brand:hover {
		background: var(--btn-plain-bg-hover);
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* 与前台导航栏标题一致：font-navbar-title 字体、text-md(1rem)、font-bold */
		font-family: var(--font-navbar-title, inherit);
		font-size: 1rem;
		font-weight: 700;
		color: inherit;
		line-height: 1.45;
	}

	/* 折叠/展开按钮：悬垂在侧边栏右上角外侧（参考 flare admin-sidebar-toggle） */
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
		border: 1px solid var(--line-divider);
		border-radius: 50%;
		background: var(--card-bg);
		color: var(--content-meta);
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.sidebar-collapse:hover {
		background: color-mix(in oklab, var(--deep-text) 8%, transparent);
		color: var(--deep-text);
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
		gap: 0.625rem;
		padding: 0.875rem 1rem;
		border: none;
		background: transparent;
		color: var(--deep-text);
		/* 保持 14px（0.875rem）不放大：一级项还要容纳展开箭头，
		   240px 侧栏内文字可用仅 160px，而俄文「Управление статьями」
		   需 150px、英文「Post Management」需 122px，提到 15px 会溢出换行 */
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		font-family: inherit;
		text-align: left;
		line-height: 1.3;
		/* 侧边栏内的链接项（返回首页）去除下划线 */
		text-decoration: none;
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
	}

	.nav-item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 一级导航项选中：涂主题色背景 + 主色文字。
	   适用于「没有子菜单」的一级项——它们本身就是导航目标，
	   选中后必须给出明确反馈（此前为 transparent，导致首页等项看不出选中）。 */
	.nav-item.active {
		background: color-mix(in oklab, var(--primary) 16%, transparent);
		color: var(--title-active);
		font-weight: 600;
	}

	/* 有子菜单的父级项：子项选中时仅文字高亮，不涂背景。
	   父级点击是展开/收起子菜单而非导航，若同样涂背景会与真正选中的子项混淆。 */
	.nav-group-head.group-active {
		background: transparent;
		color: var(--title-active);
		font-weight: 600;
	}

	.nav-arrow {
		margin-left: auto;
		flex-shrink: 0;
	}

	/* ── 网站配置：展开态内联二级菜单；折叠态右侧悬浮浮层（旧版 flyout 写法）── */
	.settings-flyout-wrap {
		position: relative;
	}

	/* 浮层面板默认隐藏，仅折叠态由 :hover/:focus-within 触发显示 */
	.flyout-panel {
		display: none;
	}

	/* 展开态：子菜单用 grid 行高动画展开收起 */
	.settings-flyout-wrap > .flyout-panel {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.settings-flyout-wrap.open > .flyout-panel {
		grid-template-rows: 1fr;
	}

	.settings-flyout-wrap > .flyout-panel .nav-submenu {
		overflow: hidden;
		min-height: 0;
	}

	.nav-submenu {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-left: 1.25rem;
		padding-left: 0.875rem;
		border-left: 2px solid var(--line-divider);
	}

	/* 配置分组小标题（侧边栏"网站配置"二级菜单） */
	.nav-group-label {
		margin-top: 0.5rem;
		margin-bottom: 0.25rem;
		padding: 0.25rem 0.875rem 0.125rem;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--content-meta);
	}

	.nav-group-label:first-child {
		margin-top: 0;
	}

	.nav-item.sub {
		padding: 0.75rem 0.875rem;
		/* 二级项无箭头，可用宽度更充裕（108px），文字可安全放大到 14px */
		font-size: 0.875rem;
		color: var(--content-meta);
		border-radius: var(--radius-lg);
	}

	.nav-item.sub.active {
		/* 二级菜单高亮：半透明主题色 */
		background: color-mix(in oklab, var(--primary) 16%, transparent);
		color: var(--title-active);
	}

	/* 悬停：已选中项加深主题色背景（保持选中标识不被灰色冲掉），
	   未选中项用中性灰，避免与选中态混淆。 */
	.nav-item.active:hover,
	.nav-item.sub.active:hover {
		background: color-mix(in oklab, var(--primary) 26%, transparent);
	}

	.nav-item:hover:not(.active),
	.nav-group-head:hover:not(.group-active) {
		background: color-mix(in oklab, var(--deep-text) 8%, transparent);
	}

	/* 底部管理员卡片：左头像（直接展示、无边框/描边/背景圈）+ 右用户名（env）/ 角色 */
	.sidebar-user {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.5rem;
		border-radius: var(--radius-lg);
		margin-bottom: 0.25rem;
		transition: background 0.15s, color 0.15s;
	}

	.sidebar-user:hover {
		background: color-mix(in oklab, var(--deep-text) 8%, transparent);
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
		border-top: 1px solid var(--line-divider);
		padding-top: 0.5rem;
		margin-top: 0.5rem;
	}

	/* 桌面端折叠模式：仅图标列 */
	@media (min-width: 1024px) {
		.admin-sidebar.collapsed {
			/* 64px：容纳 28px 品牌 Logo + 左右各 0.5rem 内边距 */
			width: 64px;
			padding: 1rem 0.5rem;
			/* 折叠按钮悬垂在右上角外侧，必须关掉滚动裁切才能显示 */
			overflow: visible;
		}

		/* 折叠时隐藏文字：导航项、品牌名、用户卡片文本。
		   浮层内的配置项通过下方高特异性规则恢复显示——面板内还包着一层
		   .nav-submenu，旧版 :not(.flyout-panel) > .nav-item 的直接子级
		   判断会漏判子项，这里改为全量隐藏 + 面板内覆盖恢复。 */
		.admin-sidebar.collapsed .nav-item > span,
		.admin-sidebar.collapsed .brand-title,
		.admin-sidebar.collapsed .user-meta {
			display: none;
		}

		/* 浮层内的配置项必须保留文字（折叠态下承担预览职责） */
		.admin-sidebar.collapsed .flyout-panel .nav-item > span {
			display: block;
		}

		/* 折叠态「网站配置」悬停浮层：右侧滑出配置列表，侧边栏保持折叠。
		   悬停/焦点移出 wrap 即随 :hover 状态消失，显示逻辑全在 CSS，无 JS。 */
		.admin-sidebar.collapsed .flyout-panel {
			display: none;
			flex-direction: column;
			gap: 0.375rem;
			position: absolute;
			top: 0;
			left: 100%;
			width: 14rem;
			max-height: calc(100vh - 8rem);
			overflow-y: auto;
			padding: 0.375rem;
			background: var(--card-bg);
			border: 1px solid var(--line-divider);
			border-radius: var(--radius-lg);
			box-shadow: var(--shadow-card-hover);
			z-index: 40;
		}

		/* 图标与面板之间的悬停桥：面板贴边定位，空隙由 ::before 承担，
		   鼠标从图标滑向面板的路径上悬停不中断，面板不会闪烁消失 */
		.admin-sidebar.collapsed .flyout-panel::before {
			content: "";
			position: absolute;
			top: 0;
			bottom: 0;
			left: -0.875rem;
			width: 0.875rem;
		}

		.admin-sidebar.collapsed .settings-flyout-wrap:hover > .flyout-panel,
		.admin-sidebar.collapsed .settings-flyout-wrap:focus-within > .flyout-panel,
		.admin-sidebar.collapsed .settings-flyout-wrap.flyout-pinned > .flyout-panel {
			display: flex;
		}

		/* 钉住状态的视觉反馈：头按钮底色与面板同理，提示当前已固定 */
		.admin-sidebar.collapsed .nav-group-head.flyout-pinned {
			background: color-mix(in oklab, var(--deep-text) 8%, transparent);
		}

		.admin-sidebar.collapsed .flyout-panel .nav-item {
			width: 100%;
			flex-shrink: 0;
			justify-content: flex-start;
		}

		/* 浮层内的展开态缩进/左线只属于内联形态，折叠浮层中还原顶格 */
		.admin-sidebar.collapsed .flyout-panel .nav-submenu {
			margin-left: 0;
			padding-left: 0;
			border-left: none;
			overflow: visible;
		}

		.admin-sidebar.collapsed .flyout-panel .nav-group-label {
			padding-left: 0.875rem;
		}

		/* 折叠态品牌区：仅 Logo，水平居中，垂直中心与导航图标同轴 */
		.admin-sidebar.collapsed .sidebar-brand {
			justify-content: center;
			padding: 0.375rem 0 0.875rem;
		}

		/* 折叠态无标题，logo 的 mb-1 mr-2 只会制造偏移，归零保持居中 */
		.admin-sidebar.collapsed .sidebar-brand .brand-logo,
		.admin-sidebar.collapsed .sidebar-brand .brand-home {
			margin-bottom: 0;
			margin-right: 0;
		}

		/* 折叠态仅图标：主视图项与「网站配置」头按钮居中。
		   居中只命中 nav/footer 的直接子级（> ），浮层面板在
		   .settings-flyout-wrap 内且隔了一层 .nav-submenu，任意层级
		   都不会被命中，子项保持基础左对齐。 */
		.admin-sidebar.collapsed .sidebar-nav > .nav-item,
		.admin-sidebar.collapsed .sidebar-footer > .nav-item,
		.admin-sidebar.collapsed .settings-flyout-wrap > .nav-item {
			justify-content: center;
			padding: 0.5rem;
		}

		.admin-sidebar.collapsed .nav-item :global(.nav-arrow) {
			display: none;
		}

		/* 释放溢出裁剪：sidebar-nav 默认 overflow-y:auto 会把 overflow-x 强制成 auto，
		   折叠态悬停浮层（absolute 定位于 wrap 右侧）会被滚动容器裁掉。
		   折叠态仅 5 个图标项，高度远小于视口，滚动需求为零，恢复 visible 让浮层可溢出 */
		.admin-sidebar.collapsed .sidebar-nav {
			overflow: visible;
		}

		/* 「网站配置」的浮层 wrap 在折叠态是普通 flex 子项，按钮按内容宽度左对齐，
		   会把图标顶到整条左缘之外——这里把 wrap 自身居中，图标中心与其它项一致 */
		.admin-sidebar.collapsed .settings-flyout-wrap {
			display: flex;
			justify-content: center;
		}

		/* 折叠态管理员卡片：仅头像居中（40px 中心对齐 20px 导航图标中心） */
		.admin-sidebar.collapsed .sidebar-user {
			justify-content: center;
			padding: 0.25rem 0 1rem;
		}

		.admin-sidebar.collapsed .sidebar-user .user-meta {
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
		height: 100%;
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

	/* 设置索引页头：标题 + 搜索框（原全局 header 的功能键下沉到页内） */
	.settings-overview-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 1rem 1.25rem;
		border: none;
		box-shadow: var(--shadow-card);
	}

	.overview-title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	/* 设置详情页头：标题 + 重新加载/保存 */
	.settings-page-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 1rem 1.25rem;
		border: none;
		box-shadow: var(--shadow-card);
	}

	.page-head-title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.page-head-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.page-head-btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: inherit;
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		transition: background 0.15s, color 0.15s;
	}

	.page-head-btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.page-head-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.page-head-btn.primary {
		background: var(--primary);
		color: var(--primary-foreground);
		border-radius: var(--radius-large);
	}

	.page-head-btn.primary:hover:not(:disabled) {
		background: color-mix(in oklch, var(--primary) 88%, black);
	}

	.search-box {
		/* ui-base 提供 .ui-search 基础形状,这里只保留设置区特有的展开宽度 */
		width: 100%;
		max-width: 260px;
	}

	.search-box.focused,
	.search-box:focus-within {
		max-width: 300px;
	}

	.admin-content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		/* 右侧内容区在可视范围内内部滚动 */
		overflow-y: auto;
		/* 内容区自身限制最大宽度并居中：不依赖子元素结构，
		   任何页面的视图都受此约束（约 1216px） */
		width: 100%;
		max-width: 76rem;
		margin-inline: auto;
	}

	/* 文章编辑器视图使用独立的页面宽度限制（editorConfig.maxPageWidth） */
	.admin-content.content-wide {
		max-width: var(--editor-max-page-width, 96rem);
	}

	/* ── 仪表板首页 ── */
	.dashboard-home {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
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
		background: var(--line-divider);
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

	/* ── 占位页（首页 / 网站配置，待后续实现） ── */
	.placeholder-page {
		padding: 3.5rem 2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
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
			top: 0;
			left: 0;
			bottom: 0;
			/* 与桌面态保持一致，否则移动端抽屉会截断品牌名 */
			width: 240px;
			z-index: 120;
			border: none;
			border-right: 1px solid var(--line-divider);
			border-radius: 0;
			transform: translateX(-100%);
			transition: transform 0.3s;
		}

		.admin-sidebar.open {
			transform: translateX(0);
			box-shadow: var(--shadow-lg);
		}

		.sidebar-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.4);
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
		background: rgba(59, 130, 246, 0.08);
		border: 1px solid rgba(59, 130, 246, 0.25);
		border-radius: var(--radius-sm);
		padding: 0.625rem 0.875rem;
	}

	.guide-tip :global(svg) {
		flex-shrink: 0;
		margin-top: 0.125rem;
		color: #3b82f6;
	}
</style>
