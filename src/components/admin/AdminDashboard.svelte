<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	CONFIG_ITEMS,
	getConfigDescKey,
	getConfigItem,
	getConfigLabelKey,
} from "@/utils/admin-settings";
import DeleteConfirmModal from "./DeleteConfirmModal.svelte";
import PostEditor from "./PostEditor.svelte";
import PostList from "./PostList.svelte";
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
type Page = "dashboard" | "posts" | "settings";

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
	| { page: "settings"; section?: string };

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
// 侧边栏状态
let postsSubOpen = $state(true); // 文章管理子菜单是否展开
let settingsSubOpen = $state(true); // 网站配置子菜单是否展开
let isSidebarOpen = $state(false); // 移动端侧边栏抽屉是否打开

const activePage = $derived<Page>(
	route.page === "dashboard"
		? "dashboard"
		: route.page === "settings"
			? "settings"
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
}

onMount(async () => {
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

async function loadSettings(key: string) {
	settingsLoading = true;
	settingsError = "";
	try {
		const res = await fetch(`/api/admin/configs/${key}/`);
		const json = await res.json();
		if (json.success) {
			settingsData = json.data;
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
	if (!key || settingsData === null) return;
	settingsSaving = true;
	try {
		const res = await fetch(`/api/admin/configs/${key}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ data: settingsData }),
		});
		const json = await res.json();
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
			showToast(`GitHub 连接正常（${data.latency}ms）`, "success", 4000);
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
	navigate(section ? `${DASHBOARD_PATH}settings/${section}/` : `${DASHBOARD_PATH}settings/`);
}

function toggleSettingsSubmenu() {
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
	duration = 3000,
) {
	toast = { message, type };
	if (type === "error") {
		console.error("[Toast] Error:", message);
	}
	setTimeout(() => {
		toast = null;
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

{#snippet statCard(label: string, value: number, icon: string, tone: string)}
	<div class="card-base stat-card">
		<div class="stat-icon {tone}">
			<Icon icon={icon} class="text-2xl" />
		</div>
		<div class="stat-info">
			<span class="stat-value">{value}</span>
			<span class="stat-label">{label}</span>
		</div>
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
			<button class="action-card" onclick={goCreatePost}>
				<div class="action-icon-wrap write">
					<Icon icon="material-symbols:edit-calendar-outline-rounded" class="action-icon" />
				</div>
				<span>{i18n(I18nKey.adminNewPost)}</span>
			</button>
			<button class="action-card" onclick={goPostList}>
				<div class="action-icon-wrap list">
					<Icon icon="material-symbols:format-list-bulleted" class="action-icon" />
				</div>
				<span>{i18n(I18nKey.adminPostList)}</span>
			</button>
			<button class="action-card" onclick={() => goSettings()}>
				<div class="action-icon-wrap settings">
					<Icon icon="material-symbols:settings" class="action-icon" />
				</div>
				<span>{i18n(I18nKey.adminSettings)}</span>
			</button>
			<button class="action-card" onclick={handleSync} disabled={isSyncing}>
				<div class="action-icon-wrap sync" class:syncing={isSyncing}>
					<Icon icon="material-symbols:cloud" class="action-icon" />
				</div>
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
			{@render statCard(i18n(I18nKey.dashboardTotalPosts), stats.total, "material-symbols:article-outline", "primary")}
			{@render statCard(i18n(I18nKey.postPublished), stats.published, "material-symbols:check", "success")}
			{@render statCard(i18n(I18nKey.dashboardDraftBox), stats.drafts, "material-symbols:folder-open-rounded", "warning")}
			{@render statCard(i18n(I18nKey.pinned), stats.pinned, "material-symbols:pinboard", "accent")}
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
		<aside class="admin-sidebar" class:open={isSidebarOpen}>
			<div class="sidebar-brand">
				<div class="brand-icon">
					<Icon icon="material-symbols:apps" class="text-lg" />
				</div>
				<span>{i18n(I18nKey.adminDashboard)}</span>
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
						<Icon
							icon={postsSubOpen ? "material-symbols:keyboard-arrow-up-rounded" : "material-symbols:keyboard-arrow-down-rounded"}
							class="nav-arrow"
						/>
					</button>
					{#if postsSubOpen}
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
					{/if}
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
						<Icon
							icon={settingsSubOpen ? "material-symbols:keyboard-arrow-up-rounded" : "material-symbols:keyboard-arrow-down-rounded"}
							class="nav-arrow"
						/>
					</button>
					{#if settingsSubOpen}
						<div class="nav-submenu">
							<button
								class="nav-item sub"
								class:active={activePage === "settings" && !settingsSection}
								onclick={() => goSettings()}
							>
								<Icon icon="material-symbols:apps" />
								<span>{i18n(I18nKey.adminSettingsOverview)}</span>
							</button>
							{#each CONFIG_ITEMS as item}
								<button
									class="nav-item sub"
									class:active={activePage === "settings" && settingsSection === item.key}
									onclick={() => goSettings(item.key)}
								>
									<Icon icon={item.icon} />
									<span>{i18n(getConfigLabelKey(item.key))}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</nav>

			<div class="sidebar-footer">
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

			<div class="admin-content">
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
							<SettingsEditor
								item={getConfigItem(settingsSection)!}
								data={settingsData}
								error={settingsError}
								isLoading={settingsLoading}
								onUpdate={(v) => (settingsData = v)}
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
{/if}

<style>
	.admin-layout {
		display: flex;
		align-items: flex-start;
		gap: 1.25rem;
	}

	/* ── 左侧导航栏 ── */
	.admin-sidebar {
		width: 248px;
		flex-shrink: 0;
		position: sticky;
		top: 1.5rem;
		display: flex;
		flex-direction: column;
		background: var(--admin-sidebar-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		padding: 1.25rem;
		gap: 0.5rem;
		box-shadow: var(--shadow-card);
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
	}

	.nav-item:hover {
		background: var(--btn-regular-bg);
	}

	.nav-item:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	.nav-item.active {
		background: var(--primary);
		color: var(--primary-foreground);
		box-shadow: var(--shadow-button);
	}

	/* 有二级菜单的父级项：高亮时使用浅色风格，避免与子菜单的实色冲突 */
	.nav-group-head.group-active {
		background: var(--btn-regular-bg);
		color: var(--primary);
	}

	.nav-arrow {
		margin-left: auto;
		flex-shrink: 0;
	}

	.nav-submenu {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-left: 1rem;
		padding-left: 0.75rem;
		border-left: 2px solid var(--line-divider);
	}

	.nav-item.sub {
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		border-radius: var(--radius-lg);
	}

	.nav-item.sub.active {
		background: var(--primary);
		color: var(--primary-foreground);
		box-shadow: var(--shadow-button);
	}

	.sidebar-footer {
		border-top: 1px solid var(--line-divider);
		padding-top: 0.5rem;
		margin-top: 0.5rem;
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
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
	}

	.stat-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem;
		transition: transform 0.2s, box-shadow 0.2s;
	}

	.stat-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-card-hover);
	}

	.stat-icon {
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-xl);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.stat-icon.primary {
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		color: var(--primary);
	}

	.stat-icon.success {
		background: color-mix(in srgb, var(--success) 16%, transparent);
		color: var(--success);
	}

	.stat-icon.warning {
		background: color-mix(in srgb, var(--warning) 16%, transparent);
		color: var(--warning);
	}

	.stat-icon.accent {
		background: color-mix(in srgb, var(--primary) 12%, var(--btn-regular-bg));
		color: var(--primary);
	}

	.stat-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.stat-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--deep-text);
		line-height: 1;
	}

	.stat-label {
		font-size: 0.875rem;
		color: var(--content-meta);
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
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.875rem;
	}

	.action-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		padding: 1.25rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-2xl);
		background: var(--card-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	.action-card:hover:not(:disabled) {
		border-color: var(--primary);
		background: var(--btn-regular-bg);
		transform: translateY(-2px);
		box-shadow: var(--shadow-card);
	}

	.action-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.action-icon-wrap {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--radius-xl);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.3s ease;
	}

	.action-icon-wrap.write {
		background: color-mix(in srgb, var(--primary) 14%, var(--card-bg));
		color: var(--primary);
	}

	.action-icon-wrap.list {
		background: color-mix(in srgb, var(--success) 14%, var(--card-bg));
		color: var(--success);
	}

	.action-icon-wrap.settings {
		background: color-mix(in srgb, var(--warning) 14%, var(--card-bg));
		color: var(--warning);
	}

	.action-icon-wrap.sync {
		background: color-mix(in srgb, var(--primary) 14%, var(--card-bg));
		color: var(--primary);
	}

	.action-icon-wrap.syncing {
		animation: pulse-soft 1.5s ease-in-out infinite;
	}

	.action-card:hover .action-icon-wrap {
		transform: scale(1.08);
	}

	:global(.action-icon) {
		font-size: 1.375rem;
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
			width: 248px;
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
			left: 1rem;
			right: 1rem;
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

		.stat-value {
			font-size: 1.5rem;
		}

		.actions-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.overview-chart {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
