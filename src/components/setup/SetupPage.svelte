<script lang="ts">
import { onMount } from "svelte";
import ConfirmDialog from "@/components/admin/ConfirmDialog.svelte";
import FloatField from "@/components/admin/ui/FloatField.svelte";
import Icon from "@/components/common/Icon.svelte";
import { SECRET_ROWS, type SecretItemState } from "@/utils/admin-secrets";
import { buildEntries, readPrivateKeyFile } from "@/utils/secret-draft";
import { portalToBody } from "@/utils/floating";

let {
	logoType = "icon",
	logoValue = "material-symbols:home-pin-outline",
	logoAlt = "",
	logoSrc = null,
}: {
	logoType?: "icon" | "image" | "url";
	logoValue?: string;
	logoAlt?: string;
	logoSrc?: string | null;
} = $props();

/**
 * 入场序列：black（全黑静置）→ logo（LOGO 放大浮现）→ rise（LOGO 上移、
 * 原位出现加载圈）→ fade（黑幕淡出，须数据已就绪）→ done
 */
let introPhase = $state<"black" | "logo" | "rise" | "fade" | "done">("black");
let introDataReady = $state(false);

// rise 阶段且数据加载完毕：短暂停顿后淡出黑幕，再收尾完成
$effect(() => {
	if (introPhase !== "rise" || !introDataReady) return;
	const t = setTimeout(() => {
		introPhase = "fade";
		setTimeout(() => (introPhase = "done"), 800);
	}, 400);
	return () => clearTimeout(t);
});

/**
 * 首次引导页（/setup/）——OOBE 壳 + 复用现有输入栏。
 *
 * 壳层结构参照用户样张：窄卡片、步骤标题、底部三段式操作区
 * （上一步 / 进度圆点 / 主按钮）、完成屏收尾。
 * 输入栏全部复用 FloatField（从登录页应急令牌输入抽出的悬浮标签组件），
 * 草稿与写入复用 secret-draft + /api/admin/secrets/ 引导分支；
 * 字段名与预填值来自接口回传（itemOf），代码里不写死。
 *
 * 与样张的差异：主按钮文字色用 --primary-foreground（前台 --btn-content
 * 在暗色下与 --primary 同色系，实心 CTA 上不可读）；保存成功去 /login/
 * （引导结束应登录），展示完成屏收尾。
 */
let items = $state<SecretItemState[]>([]);
let loading = $state(true);
let saving = $state(false);
let loadError = $state("");
let notice = $state("");

let drafts = $state<Record<string, string>>({});
let draftsOrigin = $state<Record<string, string>>({});
let addressRaw = $state("");
let addressError = $state("");
/** 1 = 登录配置，2 = 连接仓库，3 = 站点信息，4 = 完成屏 */
let step = $state<1 | 2 | 3 | 4>(1);
/** 私钥：内容不回显，查看走弹窗；粘贴入口按需展开 */
let keyView = $state(false);
let fileEl = $state<HTMLInputElement | null>(null);

// ── 管理员账号：输入用户名，调 GitHub API 自动解析数字 ID 与头像 ──
// 输入框里永远是用户名，drafts.ADMIN_GITHUB_ID 由解析结果驱动（保存的仍是数字 ID）。
let adminUsername = $state("");
let adminState = $state<"idle" | "looking" | "ok" | "error">("idle");
let adminError = $state("");
let adminResolved = $state<{
	id: string;
	login: string;
	avatar: string;
} | null>(null);
let adminTimer: ReturnType<typeof setTimeout> | undefined;
let adminAbort: AbortController | undefined;

const itemByKey = $derived(new Map(items.map((item) => [item.key, item])));
const itemOf = (key: string) => itemByKey.get(key);

/** 字段说明与后台同源：按 key 找到所属行，取该行的 how 文案 */
const howOf = (key: string) =>
	SECRET_ROWS.find((row) => row.keys.includes(key))?.how ?? "";

/** 私钥草稿是否有内容——有则显示摘要态，不回显明文 */
const hasKey = $derived(Boolean((drafts.GITHUB_PRIVATE_KEY ?? "").trim()));

/** 必填项是否齐了——完成屏据此给出「去写文章」还是「去补齐」的提示 */
const ready = $derived(
	(() => {
		const required = items.filter((item) => item.required && !item.managed);
		return required.length > 0 && required.every((item) => item.configured);
	})(),
);

function syncAddress() {
	addressRaw = addressOf();
	addressError = "";
}

function addressOf(): string {
	const owner = (drafts.GITHUB_OWNER ?? "").trim();
	const repo = (drafts.GITHUB_REPO ?? "").trim();
	const branch = (drafts.GITHUB_BRANCH ?? "").trim();
	if (!owner && !repo && !branch) return "";
	return `${owner}/${repo}${branch ? `@${branch}` : ""}`;
}

function setAddress(raw: string) {
	addressRaw = raw;
	const trimmed = raw.trim();
	if (!trimmed) {
		addressError = "";
		drafts.GITHUB_OWNER = "";
		drafts.GITHUB_REPO = "";
		drafts.GITHUB_BRANCH = "";
		return;
	}
	const m = trimmed.match(/^([^/\s]+)\/([^@\s]+)(?:@(\S+))?$/);
	if (!m) {
		addressError = "格式：owner/repo@branch";
		return;
	}
	addressError = "";
	drafts.GITHUB_OWNER = m[1];
	drafts.GITHUB_REPO = m[2];
	drafts.GITHUB_BRANCH = m[3] ?? "";
}

async function load() {
	loading = true;
	loadError = "";
	try {
		// 引导分支：未登录时服务端只放行本机 + 缺必填 + 非生产
		const res = await fetch("/api/admin/secrets/", { cache: "no-store" });
		const data = await res.json();
		if (!data.success) {
			loadError = data.message || "读取配置失败";
			return;
		}
		items = data.items;
		drafts = {};
		draftsOrigin = {};
		for (const item of items) {
			const value = item.value ?? "";
			if (value) {
				drafts[item.key] = value;
				draftsOrigin[item.key] = value;
			}
		}
		syncAddress();
		// 已配置过管理员 ID：反查一次用户资料，让输入框显示用户名与头像
		const adminId = (drafts.ADMIN_GITHUB_ID ?? "").trim();
		// 回填失败必须静默：此时输入框还是空的，报错只会让人困惑
		if (adminId) resolveAdminUser(adminId, { silent: true });
	} catch (err) {
		loadError = err instanceof Error ? err.message : "网络请求失败";
	} finally {
		loading = false;
	}
}

/**
 * GitHub 用户资料解析：/users/{用户名或数字 ID} 两条路共用同一端点。
 * silent（回填反查）时失败不显示错误——输入框还没内容，报错只会让人困惑；
 * 只有用户主动输入触发的失败才提示。
 */
async function resolveAdminUser(query: string, opts?: { silent?: boolean }) {
	const silent = opts?.silent === true;
	const q = query.trim();
	if (!q) {
		adminState = "idle";
		adminResolved = null;
		adminError = "";
		drafts.ADMIN_GITHUB_ID = "";
		return;
	}
	// 新查询取代旧请求；快速连续输入时旧响应作废，不回写旧 ID
	adminAbort?.abort();
	adminAbort = new AbortController();
	adminState = "looking";
	adminError = "";
	try {
		const res = await fetch(
			`https://api.github.com/users/${encodeURIComponent(q)}`,
			{
				signal: adminAbort.signal,
				headers: { Accept: "application/vnd.github+json" },
			},
		);
		if (res.status === 404) {
			throw new Error("GitHub 上没有这个用户名，请检查拼写");
		}
		if (!res.ok) {
			throw new Error("查询失败，稍后再试（可能触发了 GitHub 限流）");
		}
		const data = await res.json();
		adminResolved = {
			id: String(data.id),
			login: String(data.login),
			avatar: String(data.avatar_url),
		};
		drafts.ADMIN_GITHUB_ID = String(data.id);
		adminState = "ok";
		// 回填反查的场景：输入框还空着，把解析到的用户名填进去
		if (!adminUsername) adminUsername = String(data.login);
		// 用户名就位后拉取名下仓库，供仓库地址自动预填（失败静默，不阻断手填）
		fetchAdminRepos(String(data.login));
	} catch (err) {
		// 被新查询取代：静默退出，不覆盖新查询的状态
		if (err instanceof DOMException && err.name === "AbortError") return;
		adminResolved = null;
		if (silent) {
			// 回填失败不算用户操作，退回空闲态、不留错误提示
			adminState = "idle";
			adminError = "";
			return;
		}
		adminError = err instanceof Error ? err.message : "查询失败";
		adminState = "error";
	}
}

/** 用户名下的仓库清单：仓库地址从这里自动预填 */
let adminRepos = $state<{ full_name: string; default_branch: string }[]>([]);

async function fetchAdminRepos(login: string) {
	try {
		const res = await fetch(
			`https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=updated&per_page=50`,
			{ headers: { Accept: "application/vnd.github+json" } },
		);
		if (!res.ok) return;
		const list = await res.json();
		if (!Array.isArray(list)) return;
		adminRepos = list.map((r) => ({
			full_name: String(r.full_name),
			default_branch: String(r.default_branch ?? "main"),
		}));
	} catch {
		// 拉不到清单就退化为手填，不打断引导
	}
}

/** 从清单选择仓库：组装成 owner/repo@默认分支 并同步地址栏 */
function pickRepo(fullName: string) {
	const repo = adminRepos.find((r) => r.full_name === fullName);
	if (!repo) return;
	setAddress(`${repo.full_name}@${repo.default_branch}`);
}

function onAdminInput(value: string) {
	adminUsername = value;
	clearTimeout(adminTimer);
	adminTimer = setTimeout(() => resolveAdminUser(value), 500);
}

/**
 * 统一保存：落盘动作只在「下一步」「完成」两个向导节点发生。
 * 成功后直接把 configured 同步到本地状态——不再全量 load()，
 * 否则整份草稿重建会让所有输入框重渲染（页面重载的元凶）。
 * 返回是否成功，调用方据此决定是否前进到下一步。
 */
async function save(goDone: boolean): Promise<boolean> {
	if (addressError) {
		notice = "请先修正仓库地址格式";
		return false;
	}
	const entries = buildEntries(items, drafts, draftsOrigin);
	if (entries.length === 0) {
		if (goDone) step = 4;
		return true;
	}
	saving = true;
	notice = "";
	try {
		const res = await fetch("/api/admin/secrets/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entries }),
		});
		const data = await res.json();
		if (res.ok && data.success) {
			// 本地同步：草稿非空即已配置，派生态随之更新，无需网络往返
			for (const item of items) {
				item.configured = Boolean((drafts[item.key] ?? "").trim());
			}
			if (goDone) step = 4;
			return true;
		}
		notice = data.message || "保存失败";
		return false;
	} catch (err) {
		notice = `保存请求失败: ${err instanceof Error ? err.message : String(err)}`;
		return false;
	} finally {
		saving = false;
	}
}

/** 选择私钥文件：本地读取后只进草稿（摘要态立即出现），落盘交给向导节点 */
async function handleKeyFile(file: File) {
	uploadError = "";
	try {
		const content = await readPrivateKeyFile(file);
		drafts.GITHUB_PRIVATE_KEY = content;
	} catch (err) {
		uploadError = err instanceof Error ? err.message : "读取文件失败";
	}
}

/** 至少一种登录方式就绪：OAuth 两项配对，或应急令牌 */
const canLogin = $derived(
	Boolean(
		((drafts.GITHUB_APP_CLIENT_ID ?? "").trim() &&
			(drafts.GITHUB_APP_CLIENT_SECRET ?? "").trim()) ||
			(drafts.ADMIN_BREAKGLASS_TOKEN ?? "").trim(),
	),
);

/** 统一提交点之一：去登录/跳过时落盘全部草稿，再跳登录页 */
async function goLogin() {
	if (await save(false)) window.location.replace("/login/");
}

/** 私钥文件上传的本地错误（大小/读取） */
let uploadError = $state();

// ── 站点信息（step3）：引导分支读写 siteConfig 的三个基础字段 ──
let siteDraft = $state({ title: "", subtitle: "", description: "" });
let siteOrigin = $state({ title: "", subtitle: "", description: "" });
let siteLoaded = $state(false);

async function loadSite() {
	try {
		const res = await fetch("/api/admin/configs/site", { cache: "no-store" });
		const data = await res.json();
		if (!data.success || !data.data) return;
		siteDraft = {
			title: String(data.data.title ?? ""),
			subtitle: String(data.data.subtitle ?? ""),
			description: String(data.data.description ?? ""),
		};
		siteOrigin = { ...siteDraft };
		siteLoaded = true;
	} catch {
		// 站点信息是可选步骤，拉取失败不阻断向导
	}
}

/** 保存站点信息：整份配置对象回传（只改了引导涉及的三个字段） */
async function saveSite(): Promise<boolean> {
	try {
		const res = await fetch("/api/admin/configs/site", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				data: {
					title: siteDraft.title.trim(),
					subtitle: siteDraft.subtitle.trim(),
					description: siteDraft.description.trim(),
				},
			}),
		});
		const data = await res.json();
		if (res.ok && data.success) {
			siteOrigin = { ...siteDraft };
			return true;
		}
		notice = data.message || "站点信息保存失败";
		return false;
	} catch (err) {
		notice = `站点信息保存失败: ${err instanceof Error ? err.message : String(err)}`;
		return false;
	}
}

onMount(() => {
	load();
	loadSite();
	// 入场序列（Windows 12 概念版方向）：黑场静置 → LOGO 放大浮现 →
	// LOGO 上移、原位出现加载圈 → 数据就绪后黑幕淡出露出向导。
	// reduced-motion 用户直接跳过整套动画（a11y §6）。
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		introPhase = "done";
		return;
	}
	const t1 = setTimeout(() => (introPhase = "logo"), 700);
	const t2 = setTimeout(() => (introPhase = "rise"), 1600);
	void Promise.allSettled([load(), loadSite()]).then(() => {
		introDataReady = true;
	});
	return () => {
		clearTimeout(t1);
		clearTimeout(t2);
	};
});
</script>

<!-- 入场序列：黑场 → LOGO 浮现 → 淡出；一次性装饰，不可交互 -->
	{#if introPhase !== "done"}
		<div
			class="intro-black"
			class:intro-fade-out={introPhase === "fade"}
			use:portalToBody
			aria-hidden="true"
		>
			{#if introPhase === "logo" || introPhase === "rise"}
				<div
					class="intro-logo"
					class:intro-logo-risen={introPhase === "rise"}
				>
					{#if logoType === "image" && logoSrc}
						<img src={logoSrc} alt={logoAlt} />
					{:else}
						<Icon icon={logoValue} />
					{/if}
				</div>
				{#if introPhase === "rise"}
					<!-- 加载圈与 LOGO 完全独立：位置只由视口中心决定，不参考 LOGO -->
					<div class="intro-spinner"></div>
				{/if}
			{/if}
		</div>
	{/if}

	<main class="oobe">
	<article class="card">
		{#if loadError}
			<div class="state-error" role="alert">{loadError}</div>
			<button type="button" class="ghost-btn retry" onclick={load}>重试</button>
		{:else if loading}
			<div class="state-loading">加载中…</div>
		{:else if step === 4}
			<!-- 完成屏：仪式感的顶点——只有确认，没有多余动作 -->
			<div class="done-hero">
				<span class="done-ring" aria-hidden="true">
					<Icon icon="material-symbols:check" />
				</span>
				<h1 class="title">一切就绪</h1>
				<p class="desc">
					仓库和登录都已配置完成。
					{ready
						? "去登录，开始写你的第一篇文章。"
						: "部分配置项仍为空，登录后可在环境变量页补齐。"}
				</p>
			</div>
			<div class="done-action">
				<button
					type="button"
					class="primary-btn"
					onclick={() => (window.location.href = "/login/")}
				>
					去登录
				</button>
			</div>
		{:else}
			<!-- 步骤一：登录配置——最先完成，完成后即可直接登录 -->
			<div class="step" class:active={step === 1}>
				<h1 class="title">登录配置</h1>
				<p class="desc">
					绑定管理员账号并选好登录方式。完成后即可登录，仓库等其余配置稍后在后台补齐。
				</p>

				<!-- 1. 管理员用户名：基础身份，解析成功后驱动仓库清单 -->
				<FloatField
					id="fld-admin"
					label="管理员 GitHub 用户名"
					value={adminUsername}
					mono
					oninput={onAdminInput}
				/>
				<p class="field-hint">输入 GitHub 用户名，系统自动获取账号的数字 ID</p>

				{#if adminState === "looking"}
					<p class="resolve-line" aria-live="polite">正在查询该用户…</p>
				{:else if adminState === "error"}
					<p class="field-error" role="alert">{adminError}</p>
				{:else if adminState === "ok" && adminResolved}
					<div class="admin-resolved">
						<img
							class="admin-avatar"
							src={adminResolved.avatar}
							alt="GitHub 头像"
						/>
						<div class="admin-who">
							<strong>@{adminResolved.login}</strong>
							<span>ID {adminResolved.id} · 确认这是你自己</span>
						</div>
					</div>
				{/if}

				<!-- 2. 登录方式：GitHub OAuth（主）或应急令牌（备），至少填其一 -->
				<FloatField
					id="fld-client-id"
					label={itemOf("GITHUB_APP_CLIENT_ID")?.label ?? "OAuth Client ID"}
					value={drafts.GITHUB_APP_CLIENT_ID ?? ""}
					mono
					oninput={(v) => (drafts.GITHUB_APP_CLIENT_ID = v)}
				/>
				<p class="field-hint">{howOf("GITHUB_APP_CLIENT_ID")}</p>

				<FloatField
					id="fld-client-secret"
					label={itemOf("GITHUB_APP_CLIENT_SECRET")?.label ?? "OAuth Client Secret"}
					type="password"
					value={drafts.GITHUB_APP_CLIENT_SECRET ?? ""}
					oninput={(v) => (drafts.GITHUB_APP_CLIENT_SECRET = v)}
				/>
				<p class="field-hint">{howOf("GITHUB_APP_CLIENT_SECRET")}</p>

				<FloatField
					id="fld-breakglass"
					label={itemOf("ADMIN_BREAKGLASS_TOKEN")?.label ?? "应急令牌"}
					type="password"
					value={drafts.ADMIN_BREAKGLASS_TOKEN ?? ""}
					oninput={(v) => (drafts.ADMIN_BREAKGLASS_TOKEN = v)}
				/>
				<p class="field-hint">{howOf("ADMIN_BREAKGLASS_TOKEN")}</p>
			</div>

			<!-- 步骤二：连接仓库——登录后也可在后台补齐 -->
			<div class="step" class:active={step === 2}>
				<h1 class="title">连接仓库</h1>
				<p class="desc">把 GitHub App 安装到仓库，文章才能写进 GitHub。</p>

				{#if adminState === "ok" && adminResolved && adminRepos.length > 0}
					<div class="field">
						<label class="pick-label" for="fld-pick-repo">选择你的博客仓库</label>
						<select
							id="fld-pick-repo"
							class="ui-select"
							onchange={(e) => pickRepo(e.currentTarget.value)}
						>
							<option value="" disabled selected>从你名下的仓库中选择…</option>
							{#each adminRepos as repo (repo.full_name)}
								<option value={repo.full_name}>
									{repo.full_name}（默认分支 {repo.default_branch}）
								</option>
							{/each}
						</select>
					</div>
				{/if}

				<FloatField
					id="fld-repo"
					label={SECRET_ROWS.find((row) => row.id === "repo")?.label ?? "仓库地址"}
					bind:value={addressRaw}
					mono
					oninput={setAddress}
				/>
				{#if addressError}
					<p class="field-error" role="alert">{addressError}</p>
				{:else if adminRepos.length > 0 && adminState === "ok"}
					<p class="field-hint">已按你的选择预填；组织仓库或非默认分支可直接改写</p>
				{:else}
					<p class="field-hint">{howOf("GITHUB_OWNER")}</p>
				{/if}

				<FloatField
					id="fld-app-id"
					label={itemOf("GITHUB_APP_ID")?.label ?? "App ID"}
					value={drafts.GITHUB_APP_ID ?? ""}
					mono
					oninput={(v) => (drafts.GITHUB_APP_ID = v)}
				/>
				<p class="field-hint">{howOf("GITHUB_APP_ID")}</p>

				<FloatField
					id="fld-install"
					label={itemOf("GITHUB_INSTALLATION_ID")?.label ?? "安装 ID"}
					value={drafts.GITHUB_INSTALLATION_ID ?? ""}
					mono
					oninput={(v) => (drafts.GITHUB_INSTALLATION_ID = v)}
				/>
				<p class="field-hint">{howOf("GITHUB_INSTALLATION_ID")}</p>

				<!-- 私钥：只通过文件上传，内容不回显到任何输入框。
				     查看走弹窗；更换复用同一个文件选择器。落盘在向导节点统一发生。 -->
				{#if hasKey}
					<div class="key-summary">
						<span class="key-summary-word">私钥已就绪</span>
						<button type="button" class="link-btn" onclick={() => (keyView = true)}>
							查看
						</button>
						<button
							type="button"
							class="link-btn"
							disabled={saving}
							onclick={() => fileEl?.click()}
						>
							更换文件
						</button>
					</div>
				{:else}
					<div class="upload-row">
						<button
							type="button"
							class="upload-btn"
							disabled={saving}
							onclick={() => fileEl?.click()}
						>
							<Icon icon="material-symbols:upload-rounded" />
							选择私钥文件
						</button>
					</div>
					<p class="field-hint">{howOf("GITHUB_PRIVATE_KEY")}</p>
				{/if}
				{#if uploadError}
					<p class="field-error" role="alert">{uploadError}</p>
				{/if}
				<input
					type="file"
					accept=".pem,.key,.txt"
					hidden
					bind:this={fileEl}
					disabled={saving}
					onchange={async (e) => {
						const file = e.currentTarget.files?.[0];
						e.currentTarget.value = "";
						if (!file) return;
						await handleKeyFile(file);
					}}
				/>

				<FloatField
					id="fld-key-path"
					label="或私钥文件路径"
					value={drafts.GITHUB_PRIVATE_KEY_PATH ?? ""}
					mono
					oninput={(v) => (drafts.GITHUB_PRIVATE_KEY_PATH = v)}
				/>
				<p class="field-hint">可选。私钥文件存在服务器上时填路径</p>
			</div>

			
			{#if notice}
				<div class="state-error" role="alert">{notice}</div>
			{/if}

			{#if step !== 4}
			<!-- 底部三段式：可跳过的步骤显示「跳过」按钮，不可跳过则不渲染 -->
			<footer class="footer-actions">
				{#if step === 1}
					<button
						type="button"
						class="ghost-btn"
						onclick={() => (step = 2)}
					>
						下一步：连接仓库
					</button>
					<div class="dots" aria-hidden="true">
						<span class="dot" class:active={step === 1}></span>
						<span class="dot" class:active={step === 2}></span>
					</div>
					{#if canLogin}
						<button
							type="button"
							class="primary-btn"
							disabled={saving}
							onclick={goLogin}
						>
							{saving ? "保存中…" : "去登录"}
						</button>
					{/if}
				{:else if step === 2}
					<button
						type="button"
						class="ghost-btn"
						onclick={() => (step = 1)}
					>
						上一步
					</button>
					<div class="dots" aria-hidden="true">
						<span class="dot" class:active={step === 1}></span>
						<span class="dot" class:active={step === 2}></span>
						<span class="dot" class:active={step === 3}></span>
					</div>
					<div class="done-group">
						{#if canLogin}
							<button
								type="button"
								class="ghost-btn"
								onclick={goLogin}
							>
								跳过
							</button>
						{/if}
						<button
							type="button"
							class="primary-btn"
							onclick={() => (step = 3)}
						>
							下一步：站点信息
						</button>
					</div>
				{/if}
			</footer>

			<!-- 步骤三：站点信息——可选，全部字段留空可直接完成 -->
			{#if step === 3}
			<div class="step" class:active={step === 3}>
				<h1 class="title">站点信息</h1>
				<p class="desc">
					这三项会出现在浏览器标题与分享卡片上。都可以留空，登录后在后台随时改。
				</p>

				<FloatField
					id="fld-site-title"
					label="站点标题"
					value={siteDraft.title}
					oninput={(v) => (siteDraft.title = v)}
				/>
				<p class="field-hint">浏览器标签页与站点页头显示的名字</p>

				<FloatField
					id="fld-site-subtitle"
					label="站点副标题"
					value={siteDraft.subtitle}
					oninput={(v) => (siteDraft.subtitle = v)}
				/>
				<p class="field-hint">页头标题下方的一句介绍</p>

				<FloatField
					id="fld-site-description"
					label="站点描述"
					value={siteDraft.description}
					multiline
					oninput={(v) => (siteDraft.description = v)}
				/>
				<p class="field-hint">分享到社交平台时的摘要文案</p>
			</div>

			<footer class="footer-actions">
				<button
					type="button"
					class="ghost-btn"
					onclick={() => (step = 2)}
				>
					上一步
				</button>
				<div class="dots" aria-hidden="true">
					<span class="dot" class:active={step === 1}></span>
					<span class="dot" class:active={step === 2}></span>
					<span class="dot" class:active={step === 3}></span>
				</div>
				<div class="done-group">
					{#if canLogin}
						<button
							type="button"
							class="ghost-btn"
							onclick={goLogin}
						>
							跳过
						</button>
					{/if}
					<button
						type="button"
						class="primary-btn"
						disabled={saving}
						onclick={async () => {
							// 统一提交：向导中途不落盘，强退/反悔零脏数据
							if (await save(true) && (await saveSite())) step = 4;
						}}
					>
						{saving ? "保存中…" : "完成"}
					</button>
				</div>
			</footer>
			{/if}
			{/if}
		{/if}
	</article>

	<!-- 查看私钥：复用通用弹窗组件；Esc / 遮罩 / 右上角关闭均可退出 -->
	<ConfirmDialog
		open={keyView}
		title="私钥内容"
		wide
		onTertiary={() => (keyView = false)}
	>
		<pre class="modal-code">{drafts.GITHUB_PRIVATE_KEY}</pre>
	</ConfirmDialog>
</main>

<style>
	/* 页面级 OOBE token：尺寸决定集中在这里，组件只引用——不散落硬编码。
	   颜色一律引用后台继承的前台 token，明暗两态自动成立。 */
	.oobe {
		--oobe-card-radius: 24px;
		--oobe-btn-radius: 999px;
		--oobe-dur: 240ms;
		--oobe-ease: cubic-bezier(0.2, 0, 0, 1);

		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		justify-content: center;
		/* 竖向不用 align-items:center：内容高于视口时 center 会把顶部
		   裁出滚动区外（滚不动回标题）。margin:auto 同样居中，且溢出时
		   顶部仍可滚动到——参考前台内容流的滚动行为。 */
		padding: clamp(16px, 3vh, 24px) 1.5rem;
		background: var(--page-bg);
		color: var(--deep-text);
	}

	.card {
		margin: auto;
		width: 100%;
		max-width: 460px;
		background: var(--card-bg);
		border-radius: var(--oobe-card-radius);
		box-shadow: var(--shadow-card);
		/* 内距随视口高度收敛：矮屏（768 高的笔记本）也能放下整卡 */
		padding: clamp(20px, 4vh, 32px) clamp(22px, 6vw, 28px)
			clamp(16px, 3vh, 24px);
	}

	.title {
		margin: 0 0 6px;
		font-size: clamp(19px, 3.2vh, 22px);
		font-weight: 700;
		text-align: center;
		color: var(--deep-text);
	}

	.desc {
		margin: 0 0 clamp(14px, 2.5vh, 24px);
		font-size: 13px;
		line-height: 1.5;
		text-align: center;
		color: var(--content-meta);
	}

	/* 字段间距由 FloatField 自身结构 + 这里的统一节奏承担 */
	.card :global(.field) {
		margin-bottom: clamp(10px, 1.8vh, 18px);
	}

	.field-hint {
		margin: -8px 0 clamp(10px, 1.8vh, 14px);
		font-size: 12px;
		color: var(--content-meta);
	}

	.field-error {
		margin: -8px 0 clamp(10px, 1.8vh, 14px);
		font-size: 12px;
		color: var(--destructive);
	}

	/* 仓库清单下拉：标签在上方（原生 select 不做浮动标签） */
	.pick-label {
		display: block;
		margin-bottom: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--deep-text);
	}

	.card :global(.ui-select) {
		width: 100%;
		height: 42px;
	}

	/* ── 管理员解析结果：头像 + 账号 + ID，供用户确认 ── */
	.resolve-line {
		margin: -8px 0 14px;
		font-size: 12px;
		color: var(--content-meta);
	}

	.admin-resolved {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: -8px 0 14px;
		padding: 10px 14px;
		background: color-mix(in oklab, var(--primary) 8%, transparent);
		border: 1px solid color-mix(in oklab, var(--primary) 30%, transparent);
		border-radius: 12px;
	}

	.admin-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}

	.admin-who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.admin-who strong {
		font-size: 14px;
		color: var(--deep-text);
	}

	.admin-who span {
		font-size: 12px;
		color: var(--content-meta);
	}

	/* ── 步骤切换：一次淡入，尊重 reduced-motion ── */
	.step {
		display: none;
	}

	.step.active {
		display: block;
		animation: step-in var(--oobe-dur) var(--oobe-ease);
	}

	@keyframes step-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.step.active {
			animation: none;
		}
	}

	/* ── 私钥上传：按钮 + 说明一行，错误只落本行 ── */
	.upload-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 14px;
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 14px;
		border: 1px solid var(--input-border);
		border-radius: 999px;
		font-size: 13px;
		color: var(--content-meta);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.upload-btn:hover {
		color: var(--primary);
		border-color: var(--primary);
	}

	.upload-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 摘要态：私钥就绪后的那一行——状态词 + 文字动作，不回显内容 */
	.key-summary {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 56px;
		margin-bottom: 18px;
		padding: 0 16px;
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: var(--oobe-input-radius);
	}

	.key-summary-word {
		margin-right: auto;
		font-size: 15px;
		color: var(--content-meta);
	}

	.link-btn {
		background: none;
		border: none;
		padding: 4px 6px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: var(--primary);
		cursor: pointer;
		white-space: nowrap;
	}

	.link-btn:disabled {
		color: var(--content-meta);
		cursor: default;
	}

	.link-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 查看私钥的等宽正文：弹窗壳来自通用 ConfirmDialog */
	.modal-code {
		margin: 0;
		padding: 0;
		background: none;
		border: none;
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.6;
		color: var(--deep-text);
		white-space: pre-wrap;
		word-break: break-all;
	}

	/* ── 底部三段式：左返回 / 中进度 / 右主按钮 ── */
	.footer-actions {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: clamp(16px, 2.5vh, 24px);
		padding-top: clamp(14px, 2vh, 20px);
		border-top: 1px solid var(--line-divider);
	}

	.ghost-btn {
		background: none;
		border: none;
		padding: 8px 12px;
		border-radius: 8px;
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		color: var(--content-meta);
		cursor: pointer;
		transition:
			color 0.2s var(--oobe-ease),
			background 0.2s var(--oobe-ease);
	}


	.ghost-btn:hover {
		background: color-mix(in oklab, var(--deep-text) 8%, transparent);
		color: var(--deep-text);
	}

	/* 绝对居中：左右按钮宽度不等时进度点也不偏 */
	.dots {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.done-group {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-left: auto;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--input-border);
		transition: all 0.3s var(--oobe-ease);
	}

	.dot.active {
		width: 20px;
		background: var(--primary);
	}

	.primary-btn {
		background: var(--primary);
		/* 前台 --btn-content 在暗色下与 --primary 几乎同色（同色系设计），
		   实心 CTA 上不可读；后台为这个问题准备的专用 token 是 --primary-foreground */
		color: var(--primary-foreground);
		border: none;
		border-radius: var(--oobe-btn-radius);
		padding: 10px 20px;
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: filter 0.2s var(--oobe-ease);
	}

	.primary-btn:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.primary-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.primary-btn:focus-visible,
	.ghost-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* ── 完成屏 ── */
	.done-hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding-top: clamp(8px, 2vh, 16px);
	}

	.done-ring {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: color-mix(in oklab, var(--primary) 14%, transparent);
		color: var(--primary);
		font-size: 32px;
	}

	.done-action {
		display: flex;
		justify-content: center;
		margin-top: clamp(18px, 3vh, 28px);
	}

	/* ── 加载 / 错误态 ── */
	.state-loading {
		padding: 48px 0;
		text-align: center;
		color: var(--content-meta);
	}

	.state-error {
		margin-bottom: 16px;
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
		font-size: 13px;
	}
	/* ── 入场序列：黑场与 LOGO ── */
	.intro-black {
		position: fixed;
		inset: 0;
		z-index: 15000;
		display: grid;
		place-items: center;
		background: #000;
		transition: opacity 0.8s ease;
	}

	.intro-black.intro-fade-out {
		opacity: 0;
		pointer-events: none;
	}

	.intro-logo {
		display: grid;
		place-items: center;
		animation: intro-logo-in 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	/* rise 阶段：LOGO 上移腾出原位 */
	.intro-logo.intro-logo-risen {
		animation: intro-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.intro-logo :global(.inline-icon) {
		/* 参考图比例：LOGO 中等、稳占视觉中心而不喧宾夺主 */
		font-size: clamp(80px, 10vw, 112px);
		color: #fff;
	}

	.intro-logo img {
		width: clamp(80px, 10vw, 112px);
		height: clamp(80px, 10vw, 112px);
		object-fit: contain;
	}

	/* 开屏加载圈独立规格：比按钮内转圈粗约一倍、大一倍，暗底上清晰可见；
	   绝对定位在原 LOGO 的中心（stack 中心），LOGO 上移后占据原位 */
	/* 开屏加载圈独立规格：比按钮内转圈粗约一倍、大一倍，暗底上清晰可见；
	   绝对定位在原 LOGO 的中心（stack 中心），LOGO 上移后占据原位 */
	/* 参考图样式：白色细环缺口弧（约 270°，一圈缺口），不是实心全环。
	   线宽 3.5px、直径 40px——暗底上环线清晰，缺口让旋转方向可读。
	   定位与 LOGO 彻底独立：只锚定「视口中心下方固定偏移」的下部区域，
	   LOGO 无论怎么缩放或上移都不会改变它的位置 */
	.intro-spinner {
		position: absolute;
		top: calc(50% + clamp(4.75rem, 7vh, 6rem));
		left: 50%;
		width: 40px;
		height: 40px;
		border: 3.5px solid transparent;
		border-top-color: #fff;
		border-left-color: #fff;
		border-right-color: #fff;
		border-radius: 50%;
		animation: intro-spin 0.9s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite,
			intro-fade-in 0.4s ease both;
		translate: -50% 0;
	}

	@keyframes intro-logo-in {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes intro-rise {
		from {
			transform: translateY(0);
		}
		to {
			/* 轻微上移：只让出一点呼吸感，LOGO 仍是画面主体 */
			transform: translateY(-1.5rem);
		}
	}

	@keyframes intro-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes intro-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro-black,
		.intro-logo {
			animation: none;
			transition: none;
		}
	}
</style>
