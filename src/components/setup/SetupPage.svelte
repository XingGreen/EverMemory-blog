<script lang="ts">
import { onMount } from "svelte";
import ConfirmDialog from "@/components/admin/ConfirmDialog.svelte";
import Icon from "@/components/common/Icon.svelte";
import { siteConfig } from "@/config";
import { SECRET_ROWS, type SecretItemState } from "@/utils/admin-secrets";
import { buildEntries, readPrivateKeyFile } from "@/utils/secret-draft";

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
 * 首次引导页（/setup/）——六步向导。
 * 一屏一个问题：身份 / 登录方式 / 仓库 / 凭证 / 私钥 / 署名，最后一张完成屏。
 * 页面顶部只放站点标题（读自配置，第 6 步改名后即时跟新）；
 * 卡片顶行只放位置标签「首次配置」；卡片内大标题是这一步要回答的问题。
 * 落盘只在「完成」发生一次，中途跳过不留脏数据。
 */
// 页面顶部只放站点标题，不再渲染 logo；入参保留以兼容 /setup.astro
void logoType;
void logoValue;
void logoAlt;
void logoSrc;

let items = $state<SecretItemState[]>([]);
let loading = $state(true);
let saving = $state(false);
let loadError = $state("");
let notice = $state("");

let drafts = $state<Record<string, string>>({});
let draftsOrigin = $state<Record<string, string>>({});
let addressRaw = $state("");
let addressError = $state("");
/** 1–6 为步骤，7 为完成屏 */
let step = $state<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
let way = $state<"oauth" | "token">("oauth");
let keyView = $state(false);
let fileEl = $state<HTMLInputElement | null>(null);
let uploadError = $state("");

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
let adminRepos = $state<{ full_name: string; default_branch: string }[]>([]);

let siteDraft = $state({ title: "", subtitle: "", description: "" });
let siteOrigin = $state({ title: "", subtitle: "", description: "" });

const itemByKey = $derived(new Map(items.map((item) => [item.key, item])));
const itemOf = (key: string) => itemByKey.get(key);
const howOf = (key: string) =>
	SECRET_ROWS.find((row) => row.keys.includes(key))?.how ?? "";

const hasKey = $derived(Boolean((drafts.GITHUB_PRIVATE_KEY ?? "").trim()));

/** 页面顶部站点标题：配置里有值就显示，用户在第 6 步改名后即时跟新 */
const siteTitle = $derived(
	siteDraft.title.trim() || siteOrigin.title.trim() || siteConfig.title,
);

const STEPS = [
	{
		title: "谁可以管理这个站点",
		lede: "只允许一个 GitHub 账号登录后台，先把它定下来。",
		label: "身份",
		icon: "material-symbols:person",
		rules: [
			"填写 GitHub 用户名，不是邮箱或昵称",
			"数字 ID 会自动取到，无需手动查询",
		],
	},
	{
		title: "这台机器怎么确认是你",
		lede: "选一种进入后台的方式，另一种留空即可。",
		label: "登录",
		icon: "material-symbols:shield-lock",
		rules: ["两项配对使用，只填一项将无法登录"],
	},
	{
		title: "文章写进哪个仓库",
		lede: "从你的账号下挑一个，或者手动填写完整地址。",
		label: "仓库",
		icon: "material-symbols:folder-open",
		rules: ["文章会提交到这个仓库的默认分支"],
	},
	{
		title: "装上写作凭证",
		lede: "两个数字，用来确认这次提交来自这台机器。",
		label: "凭证",
		icon: "material-symbols:lock",
		rules: ["应用 ID 在应用设置页顶部", "安装 ID 是安装地址末尾的那段数字"],
	},
	{
		title: "把私钥交给它",
		lede: "提交文章时用它签名，只在这台电脑上读取。",
		label: "私钥",
		icon: "material-symbols:description",
		rules: ["内容不会显示在页面上，也不会离开这台电脑"],
	},
	{
		title: "最后署上你的名字",
		lede: "这三项决定别人看到这个站点时的第一印象。",
		label: "署名",
		icon: "material-symbols:edit",
		rules: ["显示在浏览器标签页与分享卡片上", "可以留空，登录后在后台修改"],
	},
] as const;

const current = $derived(STEPS[Math.min(step, 6) - 1]);

function addressOf(): string {
	const owner = (drafts.GITHUB_OWNER ?? "").trim();
	const repo = (drafts.GITHUB_REPO ?? "").trim();
	const branch = (drafts.GITHUB_BRANCH ?? "").trim();
	if (!owner && !repo && !branch) return "";
	return `${owner}/${repo}${branch ? `@${branch}` : ""}`;
}

function syncAddress() {
	addressRaw = addressOf();
	addressError = "";
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

function pickRepo(fullName: string) {
	const repo = adminRepos.find((r) => r.full_name === fullName);
	if (!repo) return;
	setAddress(`${repo.full_name}@${repo.default_branch}`);
}

async function load() {
	loading = true;
	loadError = "";
	try {
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
		const adminId = (drafts.ADMIN_GITHUB_ID ?? "").trim();
		if (adminId) resolveAdminUser(adminId, { silent: true });
	} catch (err) {
		loadError = err instanceof Error ? err.message : "网络请求失败";
	} finally {
		loading = false;
	}
}

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
		if (res.status === 404) throw new Error("GitHub 上没有这个用户名");
		if (!res.ok) throw new Error("查询失败，稍后再试");
		const data = await res.json();
		adminResolved = {
			id: String(data.id),
			login: String(data.login),
			avatar: String(data.avatar_url),
		};
		drafts.ADMIN_GITHUB_ID = String(data.id);
		adminState = "ok";
		if (!adminUsername) adminUsername = String(data.login);
		fetchAdminRepos(String(data.login));
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") return;
		adminResolved = null;
		if (silent) {
			adminState = "idle";
			adminError = "";
			return;
		}
		adminError = err instanceof Error ? err.message : "查询失败";
		adminState = "error";
	}
}

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
		// 拉不到清单就退化为手填
	}
}

function onAdminInput(value: string) {
	adminUsername = value;
	clearTimeout(adminTimer);
	adminTimer = setTimeout(() => resolveAdminUser(value), 500);
}

async function handleKeyFile(file: File) {
	uploadError = "";
	try {
		const content = await readPrivateKeyFile(file);
		drafts.GITHUB_PRIVATE_KEY = content;
	} catch (err) {
		uploadError = err instanceof Error ? err.message : "读取文件失败";
	}
}

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
	} catch {
		// 站点信息是可选步骤，拉取失败不阻断向导
	}
}

async function saveSite(): Promise<void> {
	// 三项都没改就不回写：读不到配置时 siteDraft 为空，全量回传会把原标题清空
	const changed =
		siteDraft.title.trim() !== siteOrigin.title ||
		siteDraft.subtitle.trim() !== siteOrigin.subtitle ||
		siteDraft.description.trim() !== siteOrigin.description;
	const empty =
		!siteDraft.title.trim() &&
		!siteDraft.subtitle.trim() &&
		!siteDraft.description.trim();
	if (!changed || empty) return;
	try {
		await fetch("/api/admin/configs/site", {
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
	} catch {
		// 站点信息失败不阻断：密钥已落盘，用户可在后台补
	}
}

async function save(): Promise<boolean> {
	if (addressError) {
		notice = "请先修正仓库地址格式";
		return false;
	}
	const entries = buildEntries(items, drafts, draftsOrigin);
	if (entries.length === 0) return true;
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
			for (const item of items) {
				item.configured = Boolean((drafts[item.key] ?? "").trim());
			}
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

async function finish() {
	const ok = await save();
	if (!ok) return;
	await saveSite();
	step = 7;
}

onMount(() => {
	void Promise.allSettled([load(), loadSite()]);
});
</script>

<div class="oobe">
	<p class="site">{siteTitle}</p>

	<section class="sheet">
		<div class="bar">
			<button
				class="back"
				type="button"
				aria-label="上一步"
				title="上一步"
				onclick={() => {
					if (step > 1) step = (step - 1) as typeof step;
				}}
				hidden={step === 1 || step === 7}
			>
				<Icon icon="material-symbols:arrow-back" />
			</button>
			<span class="ctx">首次配置</span>
		</div>

		{#if loadError}
			<p class="alert" role="alert">{loadError}</p>
			<button class="ghost" type="button" onclick={load}>重试</button>
		{:else if loading}
			<p class="loading">读取配置…</p>
		{:else if step === 7}
			<div class="sealed">
				<span class="stamp">已完成配置</span>
				<p>这台机器现在可以替你写文章了。此地址已关闭，刷新将跳转到登录页。</p>
				<p>后续修改配置，请在后台的环境变量页进行。</p>
				<div class="foot">
					<button
						class="go"
						type="button"
						onclick={() => (window.location.href = "/login/")}
					>
						开始使用
					</button>
				</div>
			</div>
		{:else}
			<div class="body">
				<div class="art" aria-hidden="true">
					<Icon icon={current.icon} style="font-size: 84px;" />
				</div>

				<div class="content">
					<h1>{current.title}</h1>
					<p class="lede">{current.lede}</p>

					{#if step === 1}
						<label class="one">
							<span>GitHub 用户名</span>
							<input
								value={adminUsername}
								placeholder="例如 evermemory"
								autocomplete="off"
								spellcheck="false"
								oninput={(e) => onAdminInput(e.currentTarget.value)}
							/>
						</label>
						{#if adminState === "looking"}
							<p class="note">正在查询…</p>
						{:else if adminState === "error"}
							<p class="note err" role="alert">{adminError}</p>
						{:else if adminState === "ok" && adminResolved}
							<p class="picked">
								<img src={adminResolved.avatar} alt="" />
								<b>@{adminResolved.login}</b>
								<span>数字 ID {adminResolved.id}</span>
							</p>
						{/if}
					{:else if step === 2}
						<ul class="list" role="listbox" aria-label="登录方式">
							<li>
								<button
									type="button"
									role="option"
									aria-selected={way === "oauth"}
									onclick={() => (way = "oauth")}
								>
									GitHub OAuth<span class="sub">推荐</span>
								</button>
							</li>
							<li>
								<button
									type="button"
									role="option"
									aria-selected={way === "token"}
									onclick={() => (way = "token")}
								>
									应急令牌<span class="sub">备用</span>
								</button>
							</li>
						</ul>
						{#if way === "oauth"}
							<label class="one">
								<span>客户端 ID</span>
								<input
									value={drafts.GITHUB_APP_CLIENT_ID ?? ""}
									spellcheck="false"
									oninput={(e) => (drafts.GITHUB_APP_CLIENT_ID = e.currentTarget.value)}
								/>
							</label>
							<label class="one">
								<span>客户端密钥</span>
								<input
									type="password"
									value={drafts.GITHUB_APP_CLIENT_SECRET ?? ""}
									oninput={(e) => (drafts.GITHUB_APP_CLIENT_SECRET = e.currentTarget.value)}
								/>
							</label>
						{:else}
							<label class="one">
								<span>应急令牌</span>
								<input
									type="password"
									value={drafts.ADMIN_BREAKGLASS_TOKEN ?? ""}
									oninput={(e) => (drafts.ADMIN_BREAKGLASS_TOKEN = e.currentTarget.value)}
								/>
							</label>
						{/if}
					{:else if step === 3}
						{#if adminRepos.length > 0}
							<ul class="list" role="listbox" aria-label="仓库">
								{#each adminRepos.slice(0, 4) as repo (repo.full_name)}
									<li>
										<button
											type="button"
											role="option"
											aria-selected={addressRaw ===
												`${repo.full_name}@${repo.default_branch}`}
											onclick={() => pickRepo(repo.full_name)}
										>
											{repo.full_name}<span class="sub">{repo.default_branch}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						<label class="one wide">
							<span>所有者 / 仓库名 @ 分支</span>
							<input
								bind:value={addressRaw}
								placeholder="owner/repo@main"
								spellcheck="false"
								oninput={(e) => setAddress(e.currentTarget.value)}
							/>
						</label>
						{#if addressError}
							<p class="note err" role="alert">{addressError}</p>
						{/if}
					{:else if step === 4}
						<label class="one">
							<span>应用 ID</span>
							<input
								value={drafts.GITHUB_APP_ID ?? ""}
								spellcheck="false"
								oninput={(e) => (drafts.GITHUB_APP_ID = e.currentTarget.value)}
							/>
						</label>
						<label class="one">
							<span>安装 ID</span>
							<input
								value={drafts.GITHUB_INSTALLATION_ID ?? ""}
								spellcheck="false"
								oninput={(e) => (drafts.GITHUB_INSTALLATION_ID = e.currentTarget.value)}
							/>
						</label>
					{:else if step === 5}
						{#if hasKey}
							<div class="file">
								<span>私钥已导入</span>
								<button class="link" type="button" onclick={() => (keyView = true)}>
									查看内容
								</button>
								<button class="link" type="button" onclick={() => fileEl?.click()}>
									重新导入
								</button>
							</div>
						{:else}
							<button class="ghost solid" type="button" onclick={() => fileEl?.click()}>
								<Icon icon="material-symbols:upload-rounded" style="font-size: 18px;" />
								导入私钥文件
							</button>
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
								if (file) await handleKeyFile(file);
							}}
						/>
						{#if uploadError}
							<p class="note err" role="alert">{uploadError}</p>
						{/if}
					{:else}
						<label class="one wide">
							<span>站点标题</span>
							<input
								value={siteDraft.title}
								oninput={(e) => (siteDraft.title = e.currentTarget.value)}
							/>
						</label>
						<label class="one wide">
							<span>一句话介绍</span>
							<input
								value={siteDraft.subtitle}
								oninput={(e) => (siteDraft.subtitle = e.currentTarget.value)}
							/>
						</label>
						<label class="one wide">
							<span>分享时的摘要</span>
							<input
								value={siteDraft.description}
								oninput={(e) => (siteDraft.description = e.currentTarget.value)}
							/>
						</label>
					{/if}

					<div class="rules">
						{#each current.rules as rule (rule)}
							<div>{rule}</div>
						{/each}
					</div>

					{#if notice}
						<p class="note err" role="alert">{notice}</p>
					{/if}

					<div class="foot">
						{#if step > 1}
							<button
								class="skip"
								type="button"
								onclick={() => {
									if (step < 6) step = (step + 1) as typeof step;
								}}
							>
								跳过
							</button>
						{/if}
						{#if step < 6}
							<button
								class="go"
								type="button"
								onclick={() => (step = (step + 1) as typeof step)}
							>
								下一步
							</button>
						{:else}
							<button class="go" type="button" disabled={saving} onclick={finish}>
								{saving ? "保存中…" : "完成"}
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</section>

	<ol class="track" aria-label="配置进度">
		{#each STEPS as s, i (s.label)}
			<li aria-current={step === i + 1 ? "step" : undefined} class:done={step > i + 1}>
				<span class="n">{i + 1}</span><span class="t">{s.label}</span>
			</li>
		{/each}
	</ol>
</div>

<ConfirmDialog
	open={keyView}
	title="私钥内容"
	wide
	onTertiary={() => (keyView = false)}
>
	<pre class="modal-code">{drafts.GITHUB_PRIVATE_KEY}</pre>
</ConfirmDialog>

<style>
	.oobe {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 24px 20px 0;
		background: var(--page-bg);
		color: var(--deep-text);
	}

	.site {
		width: 100%;
		max-width: 760px;
		margin: 0;
		text-align: center;
		font-size: 27px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--deep-text);
	}

	.sheet {
		width: 100%;
		max-width: 760px;
		height: min(500px, calc(100dvh - 148px));
		margin: auto 0 4px;
		background: var(--card-bg);
		border: 1px solid var(--line-color);
		border-radius: var(--radius-large);
		display: flex;
		flex-direction: column;
		padding: 28px;
		overflow: hidden;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 28px;
		flex: none;
	}

	.back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: none;
		border: 0;
		border-radius: 4px;
		color: var(--content-meta);
		cursor: pointer;
		font-size: 18px;
	}

	.back[hidden] {
		display: none;
	}

	.back:hover {
		color: var(--deep-text);
	}

	.ctx {
		font-size: 13px;
		color: var(--content-meta);
	}

	.body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 250px minmax(0, 1fr);
		gap: 34px;
		align-items: start;
		margin-top: 10px;
	}

	.art {
		align-self: center;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--content-meta);
	}

	.content {
		min-width: 0;
		align-self: stretch;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	h1 {
		margin: 0 0 12px;
		font-size: 27px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.3;
		color: var(--deep-text);
	}

	.lede {
		margin: 0 0 20px;
		font-size: 13px;
		line-height: 1.75;
		color: var(--content-meta);
	}

	.one {
		display: block;
	}

	.one + .one {
		margin-top: 10px;
	}

	.one span {
		display: block;
		margin-bottom: 6px;
		font-size: 12px;
		color: var(--content-meta);
	}

	.one input {
		width: 100%;
		max-width: 259px;
		padding: 8px 12px;
		font-family: var(--font-mono);
		font-size: 15px;
		color: var(--deep-text);
		background: var(--input-bg);
		border: 1px solid transparent;
		border-radius: 4px;
	}

	.one.wide input {
		max-width: none;
	}

	.one input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.rules {
		margin: 20px 0 0;
		font-size: 12px;
		line-height: 1.7;
		color: var(--content-meta);
	}

	.note {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--content-meta);
	}

	.note.err {
		color: var(--destructive);
	}

	.picked {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--content-meta);
	}

	.picked img {
		width: 22px;
		height: 22px;
		border-radius: 50%;
	}

	.picked b {
		font-weight: 500;
		font-family: var(--font-mono);
		color: var(--deep-text);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li + li {
		margin-top: 2px;
	}

	.list button {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 10px 12px;
		font: inherit;
		font-size: 14px;
		text-align: left;
		color: var(--deep-text);
		background: var(--input-bg);
		border: 0;
		border-radius: 4px;
		cursor: pointer;
	}

	.list button:hover {
		background: var(--btn-regular-bg);
	}

	.list button[aria-selected="true"] {
		box-shadow: inset 2px 0 0 var(--primary);
	}

	.list .sub {
		margin-left: 8px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--content-meta);
	}

	.file {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 40px;
		padding: 0 12px;
		font-size: 14px;
		color: var(--content-meta);
		background: var(--input-bg);
		border-radius: 4px;
	}

	.link {
		padding: 0;
		font: inherit;
		font-size: 12px;
		color: var(--primary);
		background: none;
		border: 0;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.foot {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
		margin-top: auto;
		padding-top: 18px;
		flex: none;
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	.skip {
		padding: 8px 10px;
		font-size: 13px;
		color: var(--content-meta);
		background: none;
		border: 0;
		border-radius: 4px;
	}

	.skip:hover {
		color: var(--deep-text);
		background: var(--btn-regular-bg);
	}

	.go {
		display: inline-flex;
		align-items: center;
		min-height: 34px;
		padding: 8px 16px;
		font-size: 13px;
		color: var(--primary-foreground);
		background: var(--primary);
		border: 0;
		border-radius: 6px;
	}

	.go:hover:not(:disabled) {
		filter: brightness(1.06);
	}

	.go:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 13px;
		color: var(--content-meta);
		background: none;
		border: 1px solid var(--line-color);
		border-radius: 4px;
	}

	.ghost.solid {
		font-size: 14px;
		color: var(--deep-text);
		background: var(--input-bg);
		border-color: transparent;
	}

	.back:focus-visible,
	.skip:focus-visible,
	.go:focus-visible,
	.ghost:focus-visible,
	.link:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	.loading {
		margin: 40px 0;
		text-align: center;
		font-size: 13px;
		color: var(--content-meta);
	}

	.alert {
		margin: 0 0 12px;
		padding: 8px 12px;
		border-left: 2px solid var(--destructive);
		font-size: 13px;
		color: var(--destructive);
	}

	.sealed {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	.stamp {
		display: inline-block;
		margin-bottom: 12px;
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.06em;
		color: var(--content-meta);
		border: 1px solid var(--line-color);
		border-radius: 3px;
	}

	.sealed p {
		margin: 0 0 6px;
		font-size: 13px;
		line-height: 1.8;
		color: var(--content-meta);
	}

	.track {
		width: 100%;
		max-width: 760px;
		display: flex;
		gap: 22px;
		margin: 0;
		padding: 14px 2px 16px;
		list-style: none;
	}

	.track li {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.track .n {
		font-family: var(--font-mono);
		font-size: 15px;
		color: var(--content-meta);
	}

	.track .t {
		font-size: 11px;
		color: var(--content-meta);
		white-space: nowrap;
	}

	.track li[aria-current] .n,
	.track li[aria-current] .t {
		color: var(--deep-text);
	}

	.modal-code {
		margin: 0;
		padding: 0;
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.6;
		color: var(--deep-text);
		white-space: pre-wrap;
		word-break: break-all;
	}

	@media (max-width: 700px) {
		.oobe {
			padding: 16px 0 0;
		}

		.site {
			font-size: 23px;
			padding-bottom: 12px;
		}

		.sheet {
			height: auto;
			flex: 1;
			min-height: 0;
			border: 0;
			border-radius: 0;
			padding: 18px 20px;
			margin: 0;
		}

		.body {
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
			margin-top: 6px;
		}

		.art {
			display: none;
		}

		h1 {
			margin-top: 14px;
			font-size: 23px;
		}

		.one input {
			max-width: none;
		}

		.track {
			gap: 14px;
			padding: 14px 20px 16px;
		}

		.track .t {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			transition: none !important;
		}
	}
</style>
