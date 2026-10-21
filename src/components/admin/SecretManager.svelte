<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { type AdminSecretItem, SECRET_GROUPS } from "@/utils/admin-secrets";

type SecretItemDTO = AdminSecretItem & {
	configured: boolean;
	managed?: boolean;
	preview?: string;
};

let {
	onNotify,
}: {
	onNotify: (
		message: string,
		type: "success" | "error",
		duration?: number,
	) => void;
} = $props();

let items = $state<SecretItemDTO[]>([]);
let writable = $state(false);
let envFile = $state(".env.local");
let loading = $state(true);
let loadError = $state("");
let saving = $state(false);
// 每个密钥的输入草稿：本地开发环境直接回填明文，便于查看与局部修改
let drafts = $state<Record<string, string>>({});
// 回填时的原始值，用于判断是否发生修改
let draftsOrigin = $state<Record<string, string>>({});
// 密码类输入框的显隐切换
let showInput = $state<Record<string, boolean>>({});
// 导出弹窗
let exportOpen = $state(false);
let exportBusy = $state(false);
// 正在轮换的托管密钥 key（用于按钮 loading 态）
let rotating = $state("");
// 当前展开说明的问号（空字符串表示全部收起）；同一时刻只开一个
let tipOpen = $state("");

/** 点击页面其他区域或按 Esc 时收起说明浮层 */
function closeTipOnOutside() {
	tipOpen = "";
}

function closeTipOnEsc(e: KeyboardEvent) {
	if (e.key === "Escape") tipOpen = "";
}

const groups = $derived(
	SECRET_GROUPS.map((g) => ({
		...g,
		items: items.filter((item) => item.group === g.id),
	})),
);

// 配置完成度：只统计 required 必配项
const requiredItems = $derived(items.filter((item) => item.required));
const requiredConfiguredCount = $derived(
	requiredItems.filter((item) => item.configured).length,
);
const missingRequired = $derived(
	requiredItems.filter((item) => !item.configured),
);
const allRequiredConfigured = $derived(
	requiredItems.length > 0 && requiredConfiguredCount === requiredItems.length,
);

function isDirty(item: SecretItemDTO): boolean {
	const draft = (drafts[item.key] ?? "").trim();
	// 非敏感项已预填原值，直接与草稿比较
	if (!item.sensitive) return draft !== (draftsOrigin[item.key] ?? "");
	// 敏感项：预填了原值则比较差异，否则「有输入即修改」
	if (item.key in draftsOrigin) return draft !== (draftsOrigin[item.key] ?? "");
	return draft !== "";
}

const changedCount = $derived(items.filter(isDirty).length);

async function load() {
	loading = true;
	loadError = "";
	try {
		const res = await fetch("/api/admin/secrets/");
		const data = await res.json();
		if (data.success) {
			items = data.items;
			writable = data.writable;
			envFile = data.file || ".env.local";
			// 本地开发环境：直接把明文回填到表单，便于查看与局部修改
			drafts = {};
			draftsOrigin = {};
			showInput = {};
			for (const item of items) {
				const value = item.value ?? "";
				if (value) {
					drafts[item.key] = value;
					draftsOrigin[item.key] = value;
				}
			}
		} else {
			loadError = data.message || "读取密钥状态失败";
		}
	} catch (err) {
		loadError = err instanceof Error ? err.message : "网络请求失败";
	} finally {
		loading = false;
	}
}

/** 点击眼镜：切换该字段明文的显示/隐藏（值已预填，无需再请求后端） */
function toggleReveal(item: SecretItemDTO) {
	showInput[item.key] = !showInput[item.key];
}

/** 上传文件名（仅用于回显，不参与保存） */
let uploadNames = $state<Record<string, string>>({});
/** 上传校验错误 */
let uploadError = $state<Record<string, string>>({});

const PEM_MAX_BYTES = 100 * 1024;

/**
 * 读取上传的 PEM 私钥文件并写入草稿。
 * 不做格式强校验（只拦明显错误），真正的语法校验交给保存接口；
 * 这里重点拦住「选错文件」与「文件过大」两类常见失误。
 */
async function readPemFile(
	event: Event & { currentTarget: HTMLInputElement },
	item: SecretItemDTO,
) {
	const file = event.currentTarget.files?.[0];
	// 允许重复选择同一文件：清空 value，否则 change 不再触发
	event.currentTarget.value = "";
	if (!file) return;

	uploadError[item.key] = "";
	if (file.size > PEM_MAX_BYTES) {
		uploadError[item.key] = i18n(I18nKey.secretsUploadTooLarge);
		return;
	}

	let text = "";
	try {
		text = await file.text();
	} catch {
		uploadError[item.key] = i18n(I18nKey.secretsUploadReadFailed);
		return;
	}

	if (!text.includes("-----BEGIN")) {
		uploadError[item.key] = i18n(I18nKey.secretsUploadInvalid);
		return;
	}

	drafts[item.key] = text;
	uploadNames[item.key] = file.name;
}

/**
 * 丢弃本次上传的私钥，恢复到进入页面时的状态。
 *
 * 语义是「撤销这次上传」而非「删除已有配置」：磁盘上原本有值就恢复原值
 * （界面回到已上传态、显示「已保存的私钥」）；原本没有就回到拖拽框。
 * 要真正移除配置项，把输入框清空后保存即可（清空 = 删除）。
 */
function clearPem(item: SecretItemDTO) {
	drafts[item.key] = draftsOrigin[item.key] ?? "";
	uploadNames[item.key] = "";
	uploadError[item.key] = "";
}

function buildEntries(): { key: string; value?: string; delete?: boolean }[] {
	const entries: { key: string; value?: string; delete?: boolean }[] = [];
	for (const item of items) {
		const draft = (drafts[item.key] ?? "").trim();
		if (item.key in draftsOrigin) {
			const origin = draftsOrigin[item.key] ?? "";
			if (draft === origin) continue;
			// 清空输入框即视为删除该配置项（用户手动清空即可移除）
			if (!draft) {
				entries.push({ key: item.key, delete: true });
				continue;
			}
			entries.push({ key: item.key, value: draft });
		} else if (draft) {
			entries.push({ key: item.key, value: draft });
		}
	}
	return entries;
}

async function save() {
	const entries = buildEntries();
	if (entries.length === 0) {
		onNotify("没有需要保存的修改", "error", 5000);
		return;
	}
	await doSave(entries);
}

async function doSave(
	entries: { key: string; value?: string; delete?: boolean }[],
) {
	saving = true;
	try {
		const res = await fetch("/api/admin/secrets/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entries }),
		});
		const data = await res.json();
		if (res.ok && data.success) {
			onNotify(data.message || "保存成功", "success", 10000);
			await load();
			return;
		}
		// 危险操作需「新鲜」登录态：跳 GitHub OAuth 重新授权（prompt=login）
		if (res.status === 403 && data.code === "STEP_UP_REQUIRED") {
			onNotify("身份凭证已过期，正在跳转重新验证…", "error", 6000);
			const next = encodeURIComponent(location.pathname);
			window.location.href = `/api/admin/auth/github/?force=1&next=${next}`;
			return;
		}
		onNotify(data.message || "保存失败", "error", 10000);
	} catch (err) {
		onNotify(
			`保存请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		saving = false;
	}
}

function timestampForFilename(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function downloadEnv() {
	exportBusy = true;
	try {
		const res = await fetch("/api/admin/secrets/export/?format=env");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const text = await res.text();
		const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `evermemory-env-${timestampForFilename()}.env`;
		a.click();
		URL.revokeObjectURL(url);
		onNotify(i18n(I18nKey.secretsExportEnvDone), "success", 8000);
	} catch (err) {
		onNotify(
			`导出失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			8000,
		);
	} finally {
		exportBusy = false;
	}
}

async function copyVercelCommands() {
	exportBusy = true;
	try {
		const res = await fetch("/api/admin/secrets/export/?format=vercel");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const text = await res.text();
		await navigator.clipboard.writeText(text);
		onNotify(i18n(I18nKey.secretsExportCopied), "success", 8000);
	} catch (err) {
		onNotify(
			`复制失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			8000,
		);
	} finally {
		exportBusy = false;
	}
}

async function rotate(item: SecretItemDTO) {
	if (rotating) return;
	const confirmed = window.confirm(
		i18n(I18nKey.secretsRotateConfirm).replace("{label}", item.label),
	);
	if (!confirmed) return;

	rotating = item.key;
	try {
		const res = await fetch("/api/admin/secrets/rotate/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: item.key }),
		});
		const data = await res.json();
		// 危险操作需「新鲜」登录态：跳 GitHub OAuth 重新授权（prompt=login）
		if (res.status === 403 && data.code === "STEP_UP_REQUIRED") {
			onNotify(i18n(I18nKey.secretsStepUpRequired), "error", 6000);
			const next = encodeURIComponent(location.pathname);
			window.location.href = `/api/admin/auth/github/?force=1&next=${next}`;
			return;
		}
		if (res.ok && data.success) {
			onNotify(data.message || i18n(I18nKey.secretsRotateDone), "success", 10000);
			await load();
			return;
		}
		onNotify(data.message || i18n(I18nKey.secretsRotateFailed), "error", 10000);
	} catch (err) {
		onNotify(
			`${i18n(I18nKey.secretsRotateFailed)}: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		rotating = "";
	}
}

onMount(load);
</script>

<svelte:window onclick={closeTipOnOutside} onkeydown={closeTipOnEsc} />

<div class="secrets-page">
	{#if loadError}
		<div class="status-banner error">
			<Icon icon="material-symbols:error-outline" />
			<span>{loadError}</span>
			<button class="sec-btn" onclick={load}>
				<Icon icon="material-symbols:refresh" />
				<span>{i18n(I18nKey.secretsReload)}</span>
			</button>
		</div>
	{/if}

	{#if !loading && !loadError}
		<!-- 成功提示：一行说完「已完成配置 + 写入位置」（新设计稿） -->
		{#if allRequiredConfigured}
			<div class="success-bar">
				<Icon icon="material-symbols:check-circle-outline" />
				<span>{i18n(I18nKey.secretsStatusAllDone).replace("{file}", envFile)}</span>
			</div>
		{:else}
			<div class="pending-bar">
				<Icon icon="material-symbols:info-outline" class="status-icon" />
				<span class="status-text">
					{i18n(I18nKey.secretsStatusPartial)
						.replace("{done}", String(requiredConfiguredCount))
						.replace("{total}", String(requiredItems.length))}
				</span>
				<span class="status-missing">
					{i18n(I18nKey.secretsStatusMissing)}
					{#each missingRequired as item, i (item.key)}
						<span class="status-key" title={item.key}>{item.label}</span>
						{#if i < missingRequired.length - 1}、{/if}
					{/each}
				</span>
			</div>
		{/if}
	{/if}

	<div class="toolbar card-base">
		<div class="toolbar-hint">
			<Icon
				icon={writable ? "material-symbols:save-outline" : "material-symbols:lock-outline"}
				class={writable ? "hint-ok" : "hint-warn"}
			/>
			<span>
				{writable
					? i18n(I18nKey.secretsWritableHint).replace("{file}", envFile)
					: i18n(I18nKey.secretsReadonlyHint)}
			</span>
			{#if writable}
				<span class="hint-sub">
					<Icon
						icon="material-symbols:download"
						class={writable ? "hint-ok" : "hint-warn"}
					/>
					{i18n(I18nKey.secretsExportInlineHint)}
				</span>
			{/if}
		</div>
		<div class="toolbar-actions">
			<button class="sec-btn" onclick={load} disabled={loading}>
				<Icon icon="material-symbols:refresh" />
				<span>{i18n(I18nKey.secretsReload)}</span>
			</button>
			{#if writable}
				<button
					class="sec-btn"
					title={i18n(I18nKey.secretsExport)}
					onclick={() => (exportOpen = true)}
					disabled={exportBusy || loading}
				>
					<Icon icon="material-symbols:download" />
					<span>{i18n(I18nKey.secretsExport)}</span>
				</button>
				<button
					class="sec-btn primary"
					onclick={save}
					disabled={saving || loading || changedCount === 0}
				>
					<Icon icon="material-symbols:save-outline" />
					<span
						>{saving
							? i18n(I18nKey.secretsSaving)
							: i18n(I18nKey.secretsSave)}{changedCount > 0 ? ` (${changedCount})` : ""}</span
					>
				</button>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="status-banner">
			<Icon icon="material-symbols:refresh" class="spin" />
			<span>{i18n(I18nKey.configLoading)}</span>
		</div>
	{:else}
		{#each groups as group}
			{#if group.items.length > 0}
				<!-- 每个分组是一块独立大板块：标题区 + 说明 + 纵向字段列表。
				     字段直接排布在板块内，不再各自套卡片容器（禁止卡片嵌套）。 -->
				<section class="secrets-group card-base">
					<header class="group-head">
						<span class="group-head-icon">
							<Icon icon={group.icon} />
						</span>
						<div class="group-head-text">
							<h2 class="group-title">
								<span>{i18n(I18nKey[group.labelKey])}</span>
								<span class="group-count">{group.items.length}</span>
							</h2>
							<p class="group-desc">{i18n(I18nKey[group.descKey])}</p>
						</div>
					</header>
					<div class="secret-list">
						{#each group.items as item (item.key)}
							<div class="secret-field" class:dirty={isDirty(item)}>
								<!-- 左栏：标签 + 必填星号 + 问号，下一行环境变量名 -->
								<div class="field-meta">
									<div class="field-head">
										<h3 title={item.key}>
											{#if item.sensitive}
												<Icon icon="material-symbols:lock-outline" class="lock-icon" />
											{/if}
											<span class="field-label">{item.label}</span>
											{#if item.required}<span class="req-star">*</span>{/if}
											<!-- 说明默认隐藏：悬停问号或点击切换显示，点其他区域/Esc 关闭 -->
											<div class="tip-anchor" class:open={tipOpen === item.key}>
												<button
													class="help-btn"
													type="button"
													aria-label={i18n(I18nKey.secretsFieldHelp)}
													aria-describedby={`tip-${item.key}`}
													aria-expanded={tipOpen === item.key}
													onclick={(e) => {
														e.stopPropagation();
														tipOpen = tipOpen === item.key ? "" : item.key;
													}}
												>
													<Icon icon="material-symbols:help-outline-rounded" />
												</button>
												<div class="field-tip" role="tooltip" id={`tip-${item.key}`}>
													{item.description}
												</div>
											</div>
										</h3>
									</div>
									<code class="field-key">{item.key}</code>
								</div>

								<!-- 右栏：输入控件 -->
								<div class="field-control">
									{#if item.managed}
									<!-- 托管密钥：不提供输入框，只展示状态与轮换入口 -->
									<div class="managed-row">
										<span class="managed-state">
											<Icon
												icon={item.configured
													? "material-symbols:verified-user"
													: "material-symbols:error-outline"}
												class={item.configured ? "managed-ok" : "managed-warn"}
											/>
											<span>
												{item.configured
													? i18n(I18nKey.secretsManagedConfigured)
													: i18n(I18nKey.secretsManagedMissing)}
											</span>
										</span>
										<button
											type="button"
											class="sec-btn"
											disabled={!writable || loading || rotating === item.key}
											title={writable
												? i18n(I18nKey.secretsRotateHint)
												: i18n(I18nKey.secretsRotateReadonly)}
											onclick={() => rotate(item)}
										>
											<Icon icon="material-symbols:autorenew" />
											<span>
												{rotating === item.key
													? i18n(I18nKey.secretsRotating)
													: i18n(I18nKey.secretsRotate)}
											</span>
										</button>
									</div>
								{:else}
									<!-- 本地开发环境：明文已回填，可直接查看与局部修改；
									     敏感项默认掩码，点眼镜切换显示/隐藏。
									     multiline（App 私钥）改为文件上传，避免手工粘贴丢失换行。 -->
									{#if item.kind === "multiline"}
											{#if drafts[item.key]}
												<!-- 状态二：已上传 —— 文件信息卡 + 极简清除按钮 -->
												<div class="uploaded-card">
													<span class="uploaded-icon">
														<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
															></path>
														</svg>
													</span>
													<div class="uploaded-meta">
														<span class="uploaded-name"
															>{uploadNames[item.key] ?? i18n(I18nKey.secretsUploadedDefaultName)}</span
														>
														<span class="uploaded-note">{i18n(I18nKey.secretsUploadedNote)}</span>
													</div>
													<button
														type="button"
														class="uploaded-clear"
														title={i18n(I18nKey.secretsUploadRemove)}
														aria-label={i18n(I18nKey.secretsUploadRemove)}
														onclick={() => clearPem(item)}
													>
														<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M6 18L18 6M6 6l12 12"
															></path>
														</svg>
													</button>
												</div>
											{:else}
												<!-- 状态一：未上传 —— 虚线拖拽框 -->
												<div class="upload-zone">
													<input
														type="file"
														class="upload-input"
														accept=".pem,.key"
														disabled={!writable || loading}
														aria-label={i18n(I18nKey.secretsUploadLabel)}
														onchange={(e) => readPemFile(e, item)}
													/>
													<div class="upload-inner">
														<!-- 内联上传图标：避免依赖构建期 icons.ts 是否收录该图标 -->
														<svg
															class="upload-icon"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															aria-hidden="true"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="1.5"
																d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
															></path>
														</svg>
														<span class="upload-title">{i18n(I18nKey.secretsUploadHint)}</span>
														<span class="upload-sub">{i18n(I18nKey.secretsUploadFormats)}</span>
													</div>
												</div>
											{/if}
											{#if uploadError[item.key]}
												<span class="upload-error">{uploadError[item.key]}</span>
											{/if}
										{:else}
											<div class="input-wrap">
												<input
													class="secret-input"
													type={!item.sensitive || showInput[item.key] ? "text" : "password"}
													value={drafts[item.key] ?? ""}
													spellcheck="false"
													name="secret-draft"
													autocomplete="new-password"
													placeholder={item.configured
														? i18n(I18nKey.secretsPlaceholderConfigured)
														: i18n(I18nKey.secretsPlaceholderEmpty)}
													disabled={!writable || loading}
													oninput={(e) => {
														drafts[item.key] = e.currentTarget.value;
													}}
												/>
												{#if item.sensitive}
													<button
														type="button"
														class="input-toggle"
														title={showInput[item.key]
															? i18n(I18nKey.secretsHide)
															: i18n(I18nKey.secretsShow)}
														aria-label={showInput[item.key]
															? i18n(I18nKey.secretsHide)
															: i18n(I18nKey.secretsShow)}
														onclick={() => toggleReveal(item)}
														disabled={!writable}
													>
														<Icon
															icon={showInput[item.key]
																? "material-symbols:visibility-off-outline-rounded"
																: "material-symbols:visibility-outline-rounded"}
														/>
													</button>
												{/if}
											</div>
										{/if}
								{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/each}

		{#if writable}
			<section class="card-base generator-card">
				<div class="generator-head">
					<Icon icon="material-symbols:auto-awesome" class="gen-icon" />
					<div>
						<h3>{i18n(I18nKey.secretsGenerator)}</h3>
						<p>{i18n(I18nKey.secretsGeneratorDesc)}</p>
					</div>
				</div>
				<div class="generator-row">
					<button
						class="sec-btn"
						onclick={() => {
							const jwt = items.find((i) => i.managed);
							if (jwt) rotate(jwt);
						}}
						disabled={saving || rotating !== ""}
					>
						<Icon icon="material-symbols:autorenew" />
						<span>{i18n(I18nKey.secretsRotateJwt)}</span>
					</button>
				</div>
			</section>
		{/if}
	{/if}

	{#if exportOpen}
		<div
			class="modal-overlay"
			role="dialog"
			aria-modal="true"
			aria-label={i18n(I18nKey.secretsExport)}
			tabindex="-1"
			onclick={(e) => {
				if (e.target === e.currentTarget) exportOpen = false;
			}}
			onkeydown={(e) => {
				if (e.key === "Escape") exportOpen = false;
			}}
		>
			<div class="modal-card card-base">
				<div class="modal-head">
					<h3>
						<Icon icon="material-symbols:download" class="modal-head-icon" />
						<span>{i18n(I18nKey.secretsExport)}</span>
					</h3>
					<button
						class="modal-close"
						type="button"
						aria-label={i18n(I18nKey.secretsClose)}
						onclick={() => (exportOpen = false)}
					>
						<Icon icon="material-symbols:close" />
					</button>
				</div>
				<p class="modal-desc">{i18n(I18nKey.secretsExportDesc)}</p>
				<div class="modal-warning">
					<Icon icon="material-symbols:error-outline" />
					<span>{i18n(I18nKey.secretsExportWarning)}</span>
				</div>
				<div class="modal-actions">
					<button
						class="sec-btn primary export-btn"
						onclick={downloadEnv}
						disabled={exportBusy}
					>
						<Icon icon="material-symbols:download" />
						<span>{i18n(I18nKey.secretsExportDownloadEnv)}</span>
					</button>
					<button
						class="sec-btn export-btn"
						onclick={copyVercelCommands}
						disabled={exportBusy}
					>
						<Icon icon="material-symbols:terminal-rounded" />
						<span>{i18n(I18nKey.secretsExportCopyVercel)}</span>
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.secrets-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0.25rem;
	}

	/* ── 状态横幅 ── */
	.status-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.875rem 1rem;
		border-radius: var(--radius-large);
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.875rem;
	}

	.status-banner.error {
		background: color-mix(in oklab, var(--destructive) 10%, var(--card-bg));
		color: var(--destructive);
		border: 1px solid transparent;
	}

	.status-banner .sec-btn {
		margin-left: auto;
	}

	:global(.spin) {
		animation: secrets-spin 1s linear infinite;
	}

	@keyframes secrets-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── 顶部提示条（新设计稿） ──
	   成功态：一行说清「已完成 + 写入位置」，绿色半透明底 + 同色微边框；
	   未完成态：琥珀色，附带缺失项列表。 */
	.success-bar,
	.pending-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-xl);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.success-bar {
		background: color-mix(in oklab, var(--success) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--success) 20%, transparent);
		color: var(--success);
	}

	.success-bar :global(.inline-icon) {
		flex-shrink: 0;
	}

	.pending-bar {
		background: color-mix(in oklab, var(--warning) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--warning) 20%, transparent);
		color: var(--warning);
	}

	.pending-bar :global(.status-icon) {
		color: var(--warning);
		flex-shrink: 0;
	}

	.status-text {
		font-weight: 600;
		white-space: nowrap;
	}

	.status-missing {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.status-key {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0;
		border-radius: 0;
		background: transparent;
		font-size: 0.8125rem;
		color: var(--content-meta);
		white-space: nowrap;
	}

	.status-key-code {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--warning);
	}

	/* ── 顶部工具栏 ── */
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.5rem;
		flex-wrap: wrap;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--card-bg) 88%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.toolbar-hint {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.5;
		min-width: 0;
		flex: 1;
	}

	.toolbar-hint > span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.toolbar-hint .hint-sub {
		opacity: 0.85;
	}

	.toolbar-hint :global(.hint-ok) {
		color: var(--success);
		flex-shrink: 0;
	}

	.toolbar-hint :global(.hint-warn) {
		color: var(--warning);
		flex-shrink: 0;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.sec-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-xl);
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.2s, color 0.2s;
	}

	.sec-btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.sec-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.sec-btn.primary {
		background: var(--primary);
		border-color: transparent;
		color: var(--primary-foreground);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-button);
	}

	.sec-btn.primary:hover:not(:disabled) {
		filter: brightness(1.05);
		transform: translateY(-1px);
	}

	/* ── 分组大板块 ──
	   每个分组是一块独立面板（外层 .card-base 提供底与圆角），
	   内部字段卡片用更浅的层级，形成「板块 > 卡片」两级结构。 */
	.secrets-group {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.5rem;
		border: 1px solid transparent;
		background: color-mix(in oklab, var(--card-bg) 70%, transparent);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
	}

	/* 板块标题区：图标 + 标题 + 说明 */
	.group-head {
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
	}

	.group-head-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		flex-shrink: 0;
		border-radius: var(--radius-xl);
		background: color-mix(in oklab, var(--primary) 10%, transparent);
		color: var(--primary);
	}

	.group-head-icon :global(.inline-icon) {
		font-size: 1.25rem;
	}

	.group-head-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	/* 板块标题：靠字号与字重区分大区块，不用竖线 */
	.group-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--deep-text);
	}

	.group-desc {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--content-meta);
	}

	.group-count {
		padding: 0;
		font-size: 0.75rem;
		font-weight: 400;
		color: color-mix(in oklab, var(--content-meta) 60%, transparent);
		background: transparent;
		font-family: var(--font-mono, monospace);
	}

	/* ── 字段列表 ──
	   参考设计：每行做成「左标签 + 右输入」的两栏结构，桌面端左 5/12、
	   右 7/12，窄屏折行成上下。字段本身不是卡片，只用极淡分隔线区分。 */
	.secret-list {
		display: flex;
		flex-direction: column;
	}

	.secret-field {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem 0;
		border: 0;
		background: transparent;
	}

	/* 左栏：标签 + 变量名 */
	.field-meta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 41.6667%;
		flex-shrink: 0;
		min-width: 0;
		padding-right: 1rem;
	}

	/* 右栏：输入控件 */
	.field-control {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
	}

	/* 窄屏：折成上下两段 */
	@media (max-width: 768px) {
		.secret-field {
			flex-direction: column;
			gap: 0.5rem;
		}

		.field-meta {
			width: 100%;
			padding-right: 0;
		}
	}

	/* 字段间极淡分隔线；首尾不画线，避免与板块边缘重叠 */
	.secret-field + .secret-field {
		border-top: 1px solid var(--line-color);
	}

	.secret-field:first-child {
		padding-top: 0;
	}

	.secret-field:last-child {
		padding-bottom: 0;
	}

	/* 变更状态：左侧一道细指示线 */
	.secret-field.dirty {
		padding-left: 0.875rem;
		border-left: 2px solid color-mix(in oklab, var(--primary) 55%, transparent);
	}

	.field-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.head-right {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	/* ── Plain Tooltip（参考 .examples/点击触发的-Plain-Tooltip.html） ──
	   说明默认隐藏，悬停问号或点击切换显示；点其他区域 / Esc 收起。
	   颜色取主题的反色语义：深底浅字，与卡片底自然区分。 */
	.tip-anchor {
		position: relative;
		display: inline-flex;
	}

	.help-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: color-mix(in oklab, var(--content-meta) 70%, transparent);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.15s, color 0.15s;
	}

	.help-btn :global(.inline-icon) {
		font-size: 1rem;
	}

	.help-btn:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--primary);
	}

	.help-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 浮层默认隐藏：opacity + visibility 双保险，避免透明元素仍被读屏聚焦。
	   锚点已随问号移到名称右侧，故浮层左对齐展开，避免向左溢出遮挡状态标签。 */
	.field-tip {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		width: max-content;
		max-width: 18rem;
		padding: 0.375rem 0.5rem;
		border-radius: var(--radius-sm);
		background: var(--float-panel-bg);
		color: var(--deep-text);
		font-size: 0.75rem;
		line-height: 1.5;
		box-shadow: var(--shadow-card-hover);
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transform: translateY(2px) scale(0.96);
		transform-origin: bottom left;
		transition:
			opacity 0.12s ease,
			transform 0.12s ease,
			visibility 0.12s;
		z-index: 20;
	}

	/* 小箭头 */
	.field-tip::after {
		content: "";
		position: absolute;
		top: 100%;
		left: 0.75rem;
		border: 4px solid transparent;
		border-top-color: var(--float-panel-bg);
	}

	/* 悬停或点击展开 */
	.tip-anchor:hover .field-tip,
	.tip-anchor.open .field-tip {
		opacity: 1;
		visibility: visible;
		transform: translateY(0) scale(1);
	}

	/* 标题行不裁切：问号浮层挂在 h3 内，overflow:hidden 会把它剪掉。
	   省略号下沉到 .field-label，长名称仍能正常截断。 */
	.field-head h3 {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
		min-width: 0;
	}

	.field-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.lock-icon) {
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.req-star {
		color: var(--destructive);
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.field-desc {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.55;
	}

	/* 托管密钥：状态 + 轮换按钮，替代输入框 */
	.managed-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-xl);
		background: color-mix(in oklab, var(--page-bg) 55%, var(--card-bg));
	}

	.managed-state {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		min-width: 0;
	}

	:global(.managed-ok) {
		color: var(--success);
		flex-shrink: 0;
	}

	:global(.managed-warn) {
		color: var(--warning);
		flex-shrink: 0;
	}

	.input-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
	}

	/* ── PEM 私钥上传区（参考 .examples/deepseek_html_20261021_604d10.html） ──
	   整个区域即点击热区：透明 file input 绝对定位铺满，不需要额外 JS 触发。
	   虚线边框用低对比度变量色，悬停转主色，与整页的克制配色一致。 */
	.upload-zone {
		position: relative;
		flex: 1;
		min-width: 0;
		border: 2px dashed color-mix(in oklab, var(--line-color) 80%, transparent);
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--page-bg) 45%, transparent);
		transition: border-color 0.2s ease, background 0.2s ease;
	}

	.upload-zone:hover {
		border-color: var(--primary);
		background: color-mix(in oklab, var(--page-bg) 60%, transparent);
	}

	.upload-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
		z-index: 1;
	}

	.upload-input:disabled {
		cursor: not-allowed;
	}

	.upload-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.75rem 1.5rem;
		text-align: center;
		pointer-events: none;
	}

	.upload-zone :global(svg.upload-icon) {
		width: 2rem;
		height: 2rem;
		color: color-mix(in oklab, var(--content-meta) 70%, transparent);
		transition: color 0.2s ease;
	}

	.upload-zone:hover :global(svg.upload-icon) {
		color: var(--primary);
	}

	.upload-title {
		font-size: 0.875rem;
		color: var(--content-meta);
		transition: color 0.2s ease;
	}

	.upload-zone:hover .upload-title {
		color: var(--deep-text);
	}

	.upload-sub {
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--content-meta) 60%, transparent);
	}

	.upload-error {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--destructive);
		align-self: flex-start;
	}

	/* ── 状态二：已上传的文件信息卡（参考同一份示例的 uploaded-status） ──
	   实线细边框 + 卡片底色，与上方虚线拖拽框形成「未完成 → 已完成」的视觉区分。 */
	.uploaded-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
		padding: 1rem;
		border: 1px solid color-mix(in oklab, var(--line-color) 80%, transparent);
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--page-bg) 45%, transparent);
	}

	.uploaded-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--primary) 10%, transparent);
		color: var(--primary);
	}

	.uploaded-icon :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.uploaded-meta {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1;
	}

	.uploaded-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.uploaded-note {
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--content-meta) 60%, transparent);
	}

	/* 极简清除按钮：默认低透明度，悬停转危险色 */
	.uploaded-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: var(--radius-lg);
		background: transparent;
		color: color-mix(in oklab, var(--content-meta) 70%, transparent);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}

	.uploaded-clear :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.uploaded-clear:hover {
		color: var(--destructive);
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
	}

	.uploaded-clear:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 输入框：无边框；底色比卡片暗一档，聚焦用 outline 光晕 */
	.secret-input {
		width: 100%;
		min-width: 0;
		padding: 0.625rem 0.75rem;
		border: 1px solid transparent;
		border-radius: var(--radius-xl);
		background: color-mix(in oklab, var(--page-bg) 70%, var(--card-bg));
		color: var(--deep-text);
		font-size: 0.875rem;
		font-family: inherit;
		transition: background 0.2s ease, box-shadow 0.2s ease;
		box-sizing: border-box;
	}

	.secret-input.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		resize: vertical;
		line-height: 1.5;
	}

	.secret-input:focus {
		outline: none;
		background: var(--page-bg);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 55%, transparent);
	}

	.secret-input::placeholder {
		color: color-mix(in oklab, var(--content-meta) 70%, transparent);
	}

	.secret-input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.input-wrap .secret-input {
		padding-right: 2.5rem;
	}

	/* 密码显隐图标：默认低透明度，不抢输入内容的注意力，悬停才提亮 */
	.input-toggle {
		position: absolute;
		right: 0.375rem;
		width: 1.75rem;
		height: 1.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--content-meta);
		opacity: 0.45;
		cursor: pointer;
		transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
	}

	.input-toggle:hover:not(:disabled) {
		opacity: 1;
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.input-toggle:disabled {
		cursor: not-allowed;
		opacity: 0.25;
	}

	/* 环境变量名：去掉背景色块，改成极低对比度的纯文本。
	   紧随输入框之后（不再 margin-top:auto），间距由卡片 gap 统一分配。 */
	.field-key {
		padding: 0;
		font-size: 0.75rem;
		font-family: var(--font-mono, monospace);
		letter-spacing: 0.05em;
		color: color-mix(in oklab, var(--content-meta) 55%, transparent);
		background: transparent;
		align-self: flex-start;
		word-break: break-all;
	}

	/* ── 生成工具 ── */
	.generator-card {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--card-bg) 88%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.generator-head {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	:global(.gen-icon) {
		color: var(--primary);
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.generator-head h3 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.generator-head p {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.55;
	}

	.generator-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.gen-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--deep-text);
		flex-shrink: 0;
	}

	.gen-password {
		max-width: 320px;
	}

	/* ── 弹窗（导出 / 当前密码确认） ── */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in oklab, var(--deep-text) 45%, transparent);
		-webkit-backdrop-filter: blur(2px);
		backdrop-filter: blur(2px);
		padding: 1rem;
	}

	.modal-card {
		width: 100%;
		max-width: 440px;
		padding: 1.5rem;
		/* 浮动模态用前台 --float-panel-bg，与下拉/悬浮面板同档，暗色比承载卡片高一级 */
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

	:global(.modal-head-icon) {
		color: var(--primary);
	}

	.modal-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		transition: all 0.2s;
	}

	.modal-close:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.modal-desc {
		font-size: 0.875rem;
		color: var(--content-meta);
		line-height: 1.7;
		margin-bottom: 1rem;
	}

	.modal-warning {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: color-mix(in oklab, var(--warning) 10%, transparent);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--warning);
		font-size: 0.8125rem;
		line-height: 1.6;
		margin-bottom: 1.25rem;
	}

	.modal-warning :global(svg) {
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.modal-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.625rem;
	}

	.export-btn {
		flex: 1;
		justify-content: center;
	}

	.modal-cancel {
		background: transparent;
		color: var(--content-meta);
	}

	.modal-cancel:hover {
		color: var(--deep-text);
	}

	.modal-field {
		margin-bottom: 1.25rem;
	}

	@media (max-width: 768px) {
		.secret-grid {
			grid-template-columns: 1fr;
		}

		.toolbar {
			align-items: stretch;
		}

		.toolbar-actions {
			justify-content: flex-end;
		}
	}
</style>