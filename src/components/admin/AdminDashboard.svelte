<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { editorConfig } from "@/config/editorConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
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

let { avatarUrl = "" }: { avatarUrl?: string } = $props();

// 直接读取会话状态，避免后台页在未登录时先闪现登录表单
let isVerified = $state(
	typeof sessionStorage !== "undefined"
		? sessionStorage.getItem("admin_verified") === "true"
		: false,
);
let posts = $state<Post[]>([]);
let isLoading = $state(true);
let error = $state("");
let route = $state<Route>({ page: "login" });
let editingPost = $state<Post | null>(null);
let showDeleteModal = $state(false);
let deletingPost = $state<Post | null>(null);
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
let postsSubOpen = $state(true); // 文章管理子菜单是否展开
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
		postsSubOpen = false;
		settingsSubOpen = false;
	}
	localStorage.setItem("admin-sidebar-collapsed", String(sidebarCollapsed));
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
		.slice(0, 5),
);

const publishRate = $derived(
	stats.total > 0 ? Math.round((stats.published / stats.total) * 100) : 0,
);

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

// 顶部标题随页面联动
const headerInfo = $derived.by(() => {
	if (activePage === "dashboard") {
		return {
			title: i18n(I18nKey.adminDashboard),
			subtitle: i18n(I18nKey.dashboardHomeDesc),
		};
	}
	if (activePage === "settings") {
		const item = settingsSection ? getConfigItem(settingsSection) : undefined;
		return item
			? {
					title: i18n(getConfigLabelKey(item.key)),
					subtitle: i18n(getConfigDescKey(item.key)),
				}
			: {
					title: i18n(I18nKey.adminSettings),
					subtitle: i18n(I18nKey.settingsSelectHint),
				};
	}
	if (activePage === "secrets") {
		return {
			title: i18n(I18nKey.adminSecrets),
			subtitle: i18n(I18nKey.adminSecretsDesc),
		};
	}
	if (activePage === "sessions") {
		return {
			title: i18n(I18nKey.adminSessions),
			subtitle: i18n(I18nKey.adminSessionsDesc),
		};
	}
	if (viewMode === "edit" && editingPost) {
		return { title: i18n(I18nKey.adminEditPost), subtitle: editingPost.title };
	}
	if (viewMode === "create") {
		return {
			title: i18n(I18nKey.adminNewPost),
			subtitle: i18n(I18nKey.postsManageDesc),
		};
	}
	return {
		title: i18n(I18nKey.adminPosts),
		subtitle: i18n(I18nKey.postsManageDesc),
	};
});

const headerIcon = $derived(
	activePage === "dashboard"
		? "material-symbols:home-outline-rounded"
		: activePage === "settings"
			? (settingsSection && getConfigItem(settingsSection)?.icon) ||
				"material-symbols:settings"
			: activePage === "secrets"
				? "material-symbols:shield-lock"
				: activePage === "sessions"
					? "material-symbols:devices"
					: "material-symbols:article-outline",
);

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
	try {
		const res = await fetch("/api/admin/github-ping/");
		const data = await res.json();
		if (data.success) {
			githubStatus = "ok";
			showToast(`GitHub 连接正常（${data.latency}ms）`, "success", 6000);
		} else {
			githubStatus = "fail";
			showToast(data.message || "GitHub 连接失败", "error", 6000);
		}
	} catch (err) {
		githubStatus = "fail";
		showToast(
			`请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			6000,
		);
	}
}

function handleVerify(success: boolean) {
	if (success) {
		isVerified = true;
		sessionStorage.setItem("admin_verified", "true");
		loadPosts();
		showToast("验证成功", "success");
		goDashboard();
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
	postsSubOpen = true;
	navigate(`${DASHBOARD_PATH}articles/`);
}

function goCreatePost() {
	postsSubOpen = true;
	navigate(`${DASHBOARD_PATH}articles/new/`);
}

function goEditPost(post: Post) {
	postsSubOpen = true;
	navigate(`${DASHBOARD_PATH}articles/edit/${post.slug}/`);
}

function togglePostsSubmenu() {
	// 折叠态下组头仅作为 hover 滑出触发点，不允许内联展开
	if (sidebarCollapsed) return;
	postsSubOpen = !postsSubOpen;
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

function handleDeleteClick(post: Post) {
	deletingPost = post;
	showDeleteModal = true;
}

async function handleConfirmDelete() {
	if (!deletingPost) return;

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
		<div class="welcome-glow"></div>
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

{#snippet quickActions()}
	<div class="card-base quick-actions">
		<h2>{i18n(I18nKey.quickActions)}</h2>
		<div class="actions-grid">
			<button class="action-card primary-action" onclick={goCreatePost}>
				<Icon icon="material-symbols:edit-calendar-outline-rounded" class="action-icon" />
				<span>{i18n(I18nKey.adminNewPost)}</span>
			</button>
			<button class="action-card tinted tone-success" onclick={goPostList}>
				<Icon icon="material-symbols:format-list-bulleted" class="action-icon" />
				<span>{i18n(I18nKey.adminPostList)}</span>
			</button>
			<button class="action-card tinted tone-warning" onclick={() => goSettings()}>
				<Icon icon="material-symbols:settings" class="action-icon" />
				<span>{i18n(I18nKey.adminSettings)}</span>
			</button>
			<button class="action-card tinted tone-info" onclick={handleSync} disabled={isSyncing}>
				<Icon icon="material-symbols:cloud" class={isSyncing ? "action-icon syncing" : "action-icon"} />
				<span>{isSyncing ? i18n(I18nKey.postSyncing) : i18n(I18nKey.postSyncNow)}</span>
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

{#snippet contentOverview()}
	<div class="card-base dashboard-section content-overview">
		<div class="section-header">
			<h2>{i18n(I18nKey.contentOverviewTitle)}</h2>
		</div>
		<div class="overview-chart">
			<div class="chart-ring">
				<svg viewBox="0 0 36 36" class="ring-svg">
					<path
						class="ring-bg"
						d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
					/>
					<path
						class="ring-fill published"
						stroke-dasharray="{publishRate}, 100"
						d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
					/>
				</svg>
				<div class="ring-label">
					<span class="ring-value">{publishRate}%</span>
					<span class="ring-caption">{i18n(I18nKey.postPublished)}</span>
				</div>
			</div>
			<div class="chart-legend">
				<div class="legend-item">
					<span class="legend-dot published"></span>
					<span class="legend-label">{i18n(I18nKey.postPublished)}</span>
					<span class="legend-count">{stats.published}</span>
				</div>
				<div class="legend-item">
					<span class="legend-dot draft"></span>
					<span class="legend-label">{i18n(I18nKey.postDraft)}</span>
					<span class="legend-count">{stats.drafts}</span>
				</div>
				<div class="legend-item">
					<span class="legend-dot pinned"></span>
					<span class="legend-label">{i18n(I18nKey.pinned)}</span>
					<span class="legend-count">{stats.pinned}</span>
				</div>
			</div>
		</div>
	</div>
{/snippet}

{#snippet systemStatus()}
	<div class="card-base dashboard-section system-status">
		<div class="section-header">
			<h2>{i18n(I18nKey.systemStatus)}</h2>
		</div>
		<div class="status-list">
			<div class="status-item">
				<Icon icon="material-symbols:check-circle-outline" class="status-icon healthy" />
				<div class="status-info">
					<span class="status-label">{i18n(I18nKey.statusAdminService)}</span>
					<span class="status-value">{i18n(I18nKey.statusRunning)}</span>
				</div>
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
				{@render quickActions()}
				{@render recentPostsSection()}
			</div>
			<div class="dashboard-side-col">
				{@render contentOverview()}
				{@render systemStatus()}
			</div>
		</div>
	</div>
{/snippet}

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
			<div class="sidebar-brand">
				<div class="brand-icon">
					<Icon icon="material-symbols:apps" class="text-lg" />
				</div>
				<span>{i18n(I18nKey.adminDashboard)}</span>
				<button
					class="sidebar-collapse-btn"
					onclick={toggleCollapseSidebar}
					aria-label={i18n(sidebarCollapsed ? I18nKey.adminExpandSidebar : I18nKey.adminCollapseSidebar)}
					title={i18n(sidebarCollapsed ? I18nKey.adminExpandSidebar : I18nKey.adminCollapseSidebar)}
				>
					{#if sidebarCollapsed}
						<Icon icon="material-symbols:menu-rounded" />
					{:else}
						<Icon icon="material-symbols:menu-open-rounded" />
					{/if}
				</button>
			</div>

			<nav class="sidebar-nav">
				<!-- 首页 -->
				<button
					class="nav-item"
					class:active={activePage === "dashboard"}
					onclick={goDashboard}
				>
					<Icon icon="material-symbols:home-outline-rounded" />
					<span>{i18n(I18nKey.adminHome)}</span>
				</button>

				<!-- 文章管理（二级菜单） -->
				<div class="nav-group">
					<button
						class="nav-item nav-group-head"
						class:group-active={activePage === "posts"}
						onclick={togglePostsSubmenu}
						aria-expanded={postsSubOpen}
					>
						<Icon icon="material-symbols:article-outline" />
						<span>{i18n(I18nKey.adminPosts)}</span>
						{#if !sidebarCollapsed}
							<Icon
								icon={postsSubOpen ? "material-symbols:keyboard-arrow-up-rounded" : "material-symbols:keyboard-arrow-down-rounded"}
								class="nav-arrow"
							/>
						{/if}
					</button>
					<div class="nav-submenu-wrap" class:open={postsSubOpen}>
						<div class="nav-submenu">
							<button
								class="nav-item sub"
								class:active={activePage === "posts" && (viewMode === "list" || viewMode === "edit")}
								onclick={goPostList}
							>
								<Icon icon="material-symbols:format-list-bulleted" />
								<span>{i18n(I18nKey.adminPostList)}</span>
							</button>
							<button
								class="nav-item sub"
								class:active={activePage === "posts" && viewMode === "create"}
								onclick={goCreatePost}
							>
								<Icon icon="material-symbols:edit-calendar-outline-rounded" />
								<span>{i18n(I18nKey.adminNewPost)}</span>
							</button>
						</div>
					</div>
					<!-- 折叠态悬停弹出的文章子菜单 -->
					<div class="flyout-panel" aria-hidden={!sidebarCollapsed}>
						<button
							class="nav-item sub"
							class:active={activePage === "posts" && (viewMode === "list" || viewMode === "edit")}
							onclick={goPostList}
						>
							<Icon icon="material-symbols:format-list-bulleted" />
							<span>{i18n(I18nKey.adminPostList)}</span>
						</button>
						<button
							class="nav-item sub"
							class:active={activePage === "posts" && viewMode === "create"}
							onclick={goCreatePost}
						>
							<Icon icon="material-symbols:edit-calendar-outline-rounded" />
							<span>{i18n(I18nKey.adminNewPost)}</span>
						</button>
					</div>
				</div>

				<!-- 网站配置（二级菜单） -->
				<div class="nav-group">
					<button
						class="nav-item nav-group-head"
						class:group-active={activePage === "settings"}
						onclick={toggleSettingsSubmenu}
						aria-expanded={settingsSubOpen}
					>
						<Icon icon="material-symbols:settings" />
						<span>{i18n(I18nKey.adminSettings)}</span>
						{#if !sidebarCollapsed}
							<Icon
								icon={settingsSubOpen ? "material-symbols:keyboard-arrow-up-rounded" : "material-symbols:keyboard-arrow-down-rounded"}
								class="nav-arrow"
							/>
						{/if}
					</button>
					<div class="nav-submenu-wrap" class:open={settingsSubOpen}>
						<div class="nav-submenu">
							<button
								class="nav-item sub"
								class:active={activePage === "settings" && !settingsSection}
								onclick={() => goSettings()}
							>
								<Icon icon="material-symbols:apps" />
								<span>{i18n(I18nKey.adminSettingsOverview)}</span>
							</button>
							{#each CONFIG_GROUPS as group}
							{@const groupItems = CONFIG_ITEMS.filter(
								(item) => getConfigGroup(item.key) === group.id,
							)}
							{#if groupItems.length > 0}
								<div class="nav-group-label">{i18n(group.labelKey)}</div>
								{#each groupItems as item (item.key)}
									<button
										class="nav-item sub"
										class:active={activePage === "settings" && settingsSection === item.key}
										onclick={() => goSettings(item.key)}
									>
										<Icon icon={item.icon} />
										<span>{i18n(getConfigLabelKey(item.key))}</span>
									</button>
								{/each}
							{/if}
						{/each}
						</div>
					</div>
					<!-- 折叠态悬停弹出的网站配置子菜单 -->
					<div class="flyout-panel flyout-settings" aria-hidden={!sidebarCollapsed}>
						<button
							class="nav-item sub"
							class:active={activePage === "settings" && !settingsSection}
							onclick={() => goSettings()}
						>
							<Icon icon="material-symbols:apps" />
							<span>{i18n(I18nKey.adminSettingsOverview)}</span>
						</button>
						{#each CONFIG_GROUPS as group}
						{@const groupItems = CONFIG_ITEMS.filter(
							(item) => getConfigGroup(item.key) === group.id,
						)}
						{#if groupItems.length > 0}
							<div class="nav-group-label">{i18n(group.labelKey)}</div>
							{#each groupItems as item (item.key)}
								<button
									class="nav-item sub"
									class:active={activePage === "settings" && settingsSection === item.key}
									onclick={() => goSettings(item.key)}
								>
									<Icon icon={item.icon} />
									<span>{i18n(getConfigLabelKey(item.key))}</span>
								</button>
							{/each}
						{/if}
					{/each}
					</div>
				</div>

				<!-- 密钥配置 -->
				<button
					class="nav-item"
					class:active={activePage === "secrets"}
					onclick={goSecrets}
				>
					<Icon icon="material-symbols:shield-lock" />
					<span>{i18n(I18nKey.adminSecrets)}</span>
				</button>

				<!-- 会话管理 -->
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
			<div class="card-base admin-header">
				<div class="header-content">
					<button class="menu-toggle" onclick={() => (isSidebarOpen = true)} aria-label="打开菜单">
						<Icon icon="material-symbols:menu-rounded" />
					</button>
					<div class="header-title">
						<div class="title-icon">
							<Icon icon={headerIcon} class="text-xl" />
						</div>
						<div class="title-text">
							<h1>{headerInfo.title}</h1>
							<span class="subtitle">{headerInfo.subtitle}</span>
						</div>
					</div>
				</div>
				<div class="header-actions">
				{#if activePage === "settings" && !settingsSection}
						<div class="search-box" class:focused={settingsSearchTerm.length > 0}>
							<Icon icon="material-symbols:search" class="search-icon" size="lg" />
							<input
								type="text"
								bind:value={settingsSearchTerm}
								placeholder="{i18n(I18nKey.search)}..."
								class="search-input"
								aria-label={i18n(I18nKey.search)}
							/>
							{#if settingsSearchTerm}
								<button class="search-clear" onclick={() => (settingsSearchTerm = "")} aria-label="清除">
									<Icon icon="material-symbols:close" size="sm" />
								</button>
							{/if}
						</div>
					{/if}
					{#if activePage === "posts" && viewMode === "list"}
						<button class="action-btn primary" onclick={goCreatePost}>
							<Icon icon="material-symbols:edit-calendar-outline-rounded" class="text-sm" />
							<span>{i18n(I18nKey.adminNewPost)}</span>
						</button>
					{/if}
					{#if activePage === "settings" && settingsSection && getConfigItem(settingsSection)}
						<button class="action-btn" onclick={() => loadSettings(settingsSection)} disabled={settingsLoading}>
							<Icon icon="material-symbols:refresh" class="text-sm" />
							<span>{i18n(I18nKey.configReload)}</span>
						</button>
						<button class="action-btn primary" onclick={saveSettings} disabled={settingsSaving || settingsLoading}>
							<Icon icon="material-symbols:save-outline" class="text-sm" />
							<span>{settingsSaving ? i18n(I18nKey.configSaving) : i18n(I18nKey.configSave)}</span>
						</button>
					{/if}
				</div>
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
		width: 216px;
		flex-shrink: 0;
		height: 100%;
		overflow-y: auto;
		/* 始终预留滚动条槽位：子菜单展开出现滚动条时内容不再向左偏移 */
		scrollbar-gutter: stable;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--deep-text) 25%, transparent) transparent;
		display: flex;
		flex-direction: column;
		background: var(--admin-sidebar-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		padding: 1rem;
		gap: 0.5rem;
		box-shadow: var(--shadow-card);
	}

	.admin-sidebar::-webkit-scrollbar {
		width: 6px;
	}

	.admin-sidebar::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--deep-text) 25%, transparent);
		border-radius: 999px;
	}

	.admin-sidebar::-webkit-scrollbar-track {
		background: transparent;
	}

	.sidebar-brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem 1rem;
		border-bottom: 1px solid var(--line-divider);
		margin-bottom: 0.75rem;
		font-weight: 600;
		color: var(--deep-text);
		font-size: 1rem;
	}

	.brand-icon {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-xl);
		background: var(--primary);
		color: var(--primary-foreground);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: var(--shadow-button);
	}

	.sidebar-nav {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.nav-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 1rem;
		border: none;
		background: transparent;
		color: var(--deep-text);
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: var(--radius-xl);
		cursor: pointer;
		transition: background 0.2s, color 0.2s, transform 0.15s;
		font-family: inherit;
		text-align: left;
		line-height: 1.2;
		/* 侧边栏内的链接项（返回首页）去除下划线 */
		text-decoration: none;
	}

	.nav-item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 一级菜单高亮：仅文字高亮，不涂背景 */
	.nav-item.active {
		background: transparent;
		color: var(--primary);
		font-weight: 600;
	}

	/* 有二级菜单的父级项：同样仅文字高亮 */
	.nav-group-head.group-active {
		background: transparent;
		color: var(--primary);
	}

	.nav-arrow {
		margin-left: auto;
		flex-shrink: 0;
	}

	/* 折叠子菜单动画容器（grid 行高过渡） */
	.nav-submenu-wrap {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.nav-submenu-wrap.open {
		grid-template-rows: 1fr;
	}

	.nav-submenu-wrap > .nav-submenu {
		overflow: hidden;
		min-height: 0;
	}

	.nav-submenu {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-left: 1rem;
		padding-left: 0.75rem;
		border-left: 2px solid var(--line-divider);
	}

	/* 配置分组小标题（侧边栏"网站配置"二级菜单） */
	.nav-group-label {
		margin-top: 0.5rem;
		margin-bottom: 0.125rem;
		padding: 0.25rem 0.75rem 0.125rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--content-meta);
	}

	.nav-group-label:first-child {
		margin-top: 0;
	}

	.nav-item.sub {
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		border-radius: var(--radius-lg);
	}

	.nav-item.sub.active {
		/* 二级菜单高亮：半透明主题色 */
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		color: var(--primary);
		box-shadow: none;
	}

	/* 悬停高亮：中性灰色（放在 active 规则之后，保证当前选中项悬停时也变灰） */
	.nav-item:hover,
	.nav-item.active:hover,
	.nav-item.sub.active:hover {
		background: color-mix(in srgb, var(--deep-text) 8%, transparent);
	}

	.sidebar-footer {
		border-top: 1px solid var(--line-divider);
		padding-top: 0.5rem;
		margin-top: 0.5rem;
	}

	/* 侧边栏折叠/展开按钮（位于品牌区右侧） */
	.sidebar-collapse-btn {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-lg);
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		transition: background 0.2s, color 0.2s;
		flex-shrink: 0;
	}

	.sidebar-collapse-btn:hover {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	/* 折叠态滑出的二级菜单面板（仅折叠时悬停一级图标显示） */
	.flyout-panel {
		display: none;
		position: absolute;
		top: 0;
		/* 紧贴侧栏右侧，保证鼠标从图标移到面板时 hover 不断链 */
		left: 100%;
		z-index: 70;
		min-width: 216px;
		max-width: 272px;
		max-height: min(70vh, 600px);
		overflow-y: auto;
		padding: 0.5rem;
		background: var(--admin-card-bg, var(--admin-sidebar-bg));
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: 6px 12px 28px rgba(0, 0, 0, 0.2);
	}

	.flyout-panel .nav-item {
		width: 100%;
		justify-content: flex-start;
		gap: 0.625rem;
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		border-radius: var(--radius-lg);
	}

	.flyout-panel .nav-group-label {
		display: block;
		text-transform: none;
		letter-spacing: 0.05em;
	}

	/* 桌面端折叠模式：仅图标，悬停滑出二级菜单 */
	@media (min-width: 1024px) {
		.admin-sidebar.collapsed {
			width: 56px;
			padding: 1rem 0.5rem;
			/* flyout 面板超出侧栏右边界，必须关掉滚动裁切才能显示 */
			overflow: visible;
		}

		/* 折叠时隐藏文字与内联子菜单（flyout 面板内的文字不受影响） */
		.admin-sidebar.collapsed :not(.flyout-panel) > .nav-item > span,
		.admin-sidebar.collapsed .sidebar-brand > span,
		.admin-sidebar.collapsed .nav-submenu-wrap {
			display: none;
		}

		.admin-sidebar.collapsed .sidebar-brand {
			justify-content: center;
			padding: 0.5rem 0 1rem;
		}

		/* 折叠态品牌图标让位：仅保留折叠按钮居中（避免与图标并排溢出） */
		.admin-sidebar.collapsed .brand-icon {
			display: none;
		}

		.admin-sidebar.collapsed .sidebar-collapse-btn {
			margin-left: 0;
		}

		.admin-sidebar.collapsed .nav-item {
			justify-content: center;
			padding: 0.5rem;
		}

		.admin-sidebar.collapsed .nav-group {
			position: relative;
		}

		/* flyout 内按钮保持左对齐文字布局 */
		.admin-sidebar.collapsed .flyout-panel .nav-item {
			justify-content: flex-start;
			padding: 0.625rem 0.875rem;
		}

		/* 悬停一级图标 => 右侧滑出二级菜单 */
		.admin-sidebar.collapsed .nav-group:hover > .flyout-panel,
		.admin-sidebar.collapsed .nav-group:focus-within > .flyout-panel {
			display: block;
			animation: sidebar-flyout-in 0.22s ease;
		}
	}

	@keyframes sidebar-flyout-in {
		from {
			opacity: 0;
			transform: translateX(-6px);
		}

		to {
			opacity: 1;
			transform: translateX(0);
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

	.admin-header {
		padding: 1.25rem 1.5rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		box-shadow: var(--shadow-card);
		border: none;
		/* 页头同样限制最大宽度并居中，避免大屏下横向拉得过长 */
		width: 100%;
		max-width: 76rem;
		margin-inline: auto;
	}

	.header-content {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
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
		transition: background 0.2s;
	}

	.menu-toggle:hover {
		background: var(--btn-regular-bg-hover);
	}

	.title-icon {
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--primary);
		color: var(--primary-foreground);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-button);
	}

	.title-text {
		min-width: 0;
	}

	.title-text h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.subtitle {
		font-size: 0.875rem;
		color: var(--content-meta);
		margin-top: 0.25rem;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		align-items: center;
	}

	.search-box {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		max-width: 260px;
		height: 40px;
		padding: 0 0.625rem 0 0.875rem;
		background: var(--page-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-full);
		transition: border-color 0.2s ease, box-shadow 0.2s ease, max-width 0.2s ease;
	}

	.search-box:focus-within,
	.search-box.focused {
		border-color: var(--primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent);
	}

	.search-box:focus-within {
		max-width: 300px;
	}

	:global(.search-icon) {
		color: var(--content-meta);
		flex-shrink: 0;
		transition: color 0.2s ease;
	}

	.search-box:focus-within :global(.search-icon) {
		color: var(--primary);
	}

	.search-input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: 0.9375rem;
		color: var(--deep-text);
		padding: 0 0.5rem;
		font-family: inherit;
	}

	.search-input:focus {
		outline: none;
	}

	.search-input::placeholder {
		color: var(--content-meta);
		opacity: 0.8;
	}

	.search-clear {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.search-clear:hover {
		background: var(--btn-regular-bg-hover);
		color: var(--deep-text);
	}

	.action-btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: inherit;
	}

	.action-btn.primary {
		background: var(--primary);
		color: var(--primary-foreground);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-button);
	}

	.action-btn.primary:hover:not(:disabled) {
		filter: brightness(1.05);
		transform: translateY(-1px);
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

	/* 欢迎横幅 */
	.welcome-banner {
		position: relative;
		overflow: hidden;
		background: linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 75%, black) 100%);
		color: var(--primary-foreground);
		border-radius: var(--radius-large);
		padding: 1.75rem 2rem;
		box-shadow: var(--shadow-button);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
	}

	.welcome-glow {
		position: absolute;
		top: -50%;
		right: -10%;
		width: 20rem;
		height: 20rem;
		background: radial-gradient(circle, rgba(255, 255, 255, 0.25) 0%, transparent 70%);
		pointer-events: none;
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
		opacity: 0.95;
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
		opacity: 0.85;
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
		border-radius: var(--radius-large);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.welcome-btn.primary {
		background: var(--primary-foreground);
		color: var(--primary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}

	.welcome-btn.primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
	}

	/* 统计卡片 */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
	}

	/* ── MD3 统计卡片：色调底色 + 大圆角 + 右下角装饰图标 ── */
	.stat-card {
		position: relative;
		overflow: hidden;
		min-width: 0;
		padding: 1.25rem 1.25rem 1.75rem;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--primary) 8%, var(--card-bg));
		transition:
			background 0.2s ease,
			box-shadow 0.2s ease;
	}

	/* MD3 state layer：悬浮时底色加深 */
	.stat-card:hover {
		background: color-mix(in oklab, var(--primary) 16%, var(--card-bg));
		box-shadow: var(--shadow-card-hover);
	}

	:global(.dark) .stat-card {
		background: color-mix(in oklab, var(--primary) 14%, var(--card-bg));
	}

	:global(.dark) .stat-card:hover {
		background: color-mix(in oklab, var(--primary) 22%, var(--card-bg));
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

	/* 装饰图标：右下角、低透明度，悬浮时增强 */
	/* 装饰图标：右下角、低透明度，悬浮时增强
	   Icon 为子组件，其根元素需 :global 才能命中本组件 scoped 样式 */
	:global(.stat-deco-icon) {
		position: absolute;
		right: 0.75rem;
		bottom: 0.5rem;
		line-height: 1;
		color: var(--primary);
		opacity: 0.32;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	.stat-card:hover :global(.stat-deco-icon) {
		opacity: 0.5;
	}

	/* Dashboard 两栏布局 */
	.dashboard-grid {
		display: grid;
		grid-template-columns: 1.4fr 0.6fr;
		gap: 1rem;
		align-items: start;
	}

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
		color: var(--primary);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-md);
		transition: background 0.15s;
		font-family: inherit;
	}

	.section-link:hover {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	/* 快捷操作 */
	.quick-actions {
		padding: 1.5rem;
	}

	.quick-actions h2 {
		font-size: 0.9375rem;
		font-weight: 500;
		letter-spacing: 0.03125rem;
		color: var(--content-meta);
		margin-bottom: 1rem;
	}

	.actions-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.action-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		padding: 1.125rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-2xl);
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.8125rem;
		font-weight: 400;
		font-family: inherit;
		cursor: pointer;
		transition:
			background 0.2s,
			transform 0.1s;
	}

	/* state layer：hover 极轻微提亮，active 轻微按下 */
	.action-card:hover:not(:disabled) {
		background: color-mix(in oklab, var(--primary) 8%, var(--btn-regular-bg));
	}

	.action-card:active:not(:disabled) {
		transform: scale(0.97);
	}

	.action-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* 唯一强调项：新建文章，用极淡的 primary 底色而非全填充 */
	.action-card.primary-action {
		border-color: transparent;
		background: color-mix(in oklab, var(--primary) 10%, var(--btn-regular-bg));
		color: var(--primary);
		font-weight: 500;
	}

	.action-card.primary-action:hover:not(:disabled) {
		background: color-mix(in oklab, var(--primary) 15%, var(--btn-regular-bg));
	}

	/* 其余三项：低饱和粉彩底色，安静但有功能区区分度
	   底色淡、文字保持深色可读，仅图标带色，避免与强调项抢视线 */
	.action-card.tone-success {
		--tone: var(--success);
	}

	.action-card.tone-warning {
		--tone: var(--warning);
	}

	.action-card.tone-info {
		--tone: var(--info);
	}

	.action-card.tinted {
		color: var(--content-meta);
		border-color: color-mix(in oklab, var(--tone) 26%, transparent);
		background: color-mix(in oklab, var(--tone) 14%, var(--btn-regular-bg));
	}

	.action-card.tinted:hover:not(:disabled) {
		background: color-mix(in oklab, var(--tone) 23%, var(--btn-regular-bg));
	}

	.action-card.tinted :global(.action-icon) {
		color: var(--tone);
		opacity: 1;
	}

	:global(.dark) .action-card.tinted {
		background: color-mix(in oklab, var(--tone) 18%, var(--btn-regular-bg));
	}

	:global(.dark) .action-card.tinted:hover:not(:disabled) {
		background: color-mix(in oklab, var(--tone) 27%, var(--btn-regular-bg));
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
		border-radius: var(--radius-xl);
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

	/* 内容概览 */
	.overview-chart {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 0.5rem 0;
	}

	.chart-ring {
		position: relative;
		width: 6.5rem;
		height: 6.5rem;
		flex-shrink: 0;
	}

	.ring-svg {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}

	.ring-bg {
		fill: none;
		stroke: var(--line-divider);
		stroke-width: 3;
	}

	.ring-fill {
		fill: none;
		stroke-width: 3;
		stroke-linecap: round;
		transition: stroke-dasharray 0.6s ease;
	}

	.ring-fill.published {
		stroke: var(--success);
	}

	.ring-label {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.ring-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--deep-text);
	}

	.ring-caption {
		font-size: 0.6875rem;
		color: var(--content-meta);
	}

	.chart-legend {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.legend-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.legend-dot.published {
		background: var(--success);
	}

	.legend-dot.draft {
		background: var(--warning);
	}

	.legend-dot.pinned {
		background: var(--primary);
	}

	.legend-label {
		color: var(--content-meta);
	}

	.legend-count {
		margin-left: auto;
		font-weight: 600;
		color: var(--deep-text);
	}

	/* 系统状态 */
	.status-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.status-item {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.625rem 0.5rem;
		border-radius: var(--radius-xl);
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
		border-radius: 9999px;
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

	.connectivity-btn:active:not(:disabled) {
		transform: translateY(1px);
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
		background: color-mix(in srgb, var(--primary) 12%, transparent);
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
		border-radius: var(--radius-xl);
		color: white;
		font-weight: 500;
		box-shadow: var(--shadow-card-hover);
		animation: slideIn 0.3s ease-out;
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		backdrop-filter: blur(8px);
	}

	.toast.success {
		background: color-mix(in srgb, var(--success) 92%, transparent);
	}

	.toast.error {
		background: color-mix(in srgb, var(--destructive) 92%, transparent);
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
		transition: background 0.2s;
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
		.admin-sidebar {
			position: fixed;
			top: 0;
			left: 0;
			bottom: 0;
			width: 216px;
			z-index: 120;
			border: none;
			border-right: 1px solid var(--line-divider);
			border-radius: 0;
			transform: translateX(-100%);
			transition: transform 0.3s ease;
			box-shadow: none;
		}

		.admin-sidebar.open {
			transform: translateX(0);
			box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);
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
		.admin-header {
			padding: 1rem 1.25rem;
			flex-wrap: wrap;
		}

		.header-actions {
			width: 100%;
			justify-content: flex-end;
		}

		.search-box {
			max-width: none;
			width: 100%;
		}

		.search-box:focus-within {
			max-width: none;
		}

		.title-text h1 {
			font-size: 1.0625rem;
		}

		.subtitle {
			font-size: 0.75rem;
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

		.overview-chart {
			flex-direction: column;
			align-items: flex-start;
		}
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
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
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
