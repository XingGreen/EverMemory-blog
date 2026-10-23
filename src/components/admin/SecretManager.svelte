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
// 「凭据操作」折叠区的展开状态（按配置项 key 记录，默认收起）
let disclosureOpen = $state<Record<string, boolean>>({});

function toggleDisclosure(key: string) {
	disclosureOpen[key] = disclosureOpen[key] !== true;
}

/**
 * 放弃修改：把所有草稿回滚到载入时的 baseline。
 * 对应参考项目 settings-savebar 的「放弃修改」。
 */
function discardAll() {
	drafts = { ...draftsOrigin };
	uploadNames = {};
	uploadError = {};
}

/** 有未保存改动时，离开页面前拦截（对应参考项目 enableBeforeUnload） */
function onBeforeUnload(e: BeforeUnloadEvent) {
	if (changedCount > 0) {
		e.preventDefault();
		e.returnValue = "";
	}
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

<svelte:window onbeforeunload={onBeforeUnload} />

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

	<!-- 操作栏：左说明右按钮，作为工作区顶部的工具栏（与设置页 savebar 同源） -->
	<div class="action-bar">
		<div class="action-info">
			<strong>
				{writable
					? i18n(I18nKey.secretsWritableHint).replace("{file}", envFile)
					: i18n(I18nKey.secretsReadonlyHint)}
			</strong>
			{#if writable}
				<span>{i18n(I18nKey.secretsExportInlineHint)}</span>
			{/if}
		</div>
		<div class="action-buttons">
			<button class="btn" type="button" onclick={load} disabled={loading}>
				<Icon icon="material-symbols:refresh" />
				<span>{i18n(I18nKey.secretsReload)}</span>
			</button>
			{#if writable}
				<button
					class="btn"
					type="button"
					title={i18n(I18nKey.secretsExport)}
					onclick={() => (exportOpen = true)}
					disabled={exportBusy || loading}
				>
					<Icon icon="material-symbols:download" />
					<span>{i18n(I18nKey.secretsExport)}</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- 状态提示：一行说完「已完成配置 + 写入位置」 -->
	{#if !loading && !loadError}
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

	{#if loading}
		<div class="status-banner">
			<Icon icon="material-symbols:refresh" class="spin" />
			<span>{i18n(I18nKey.configLoading)}</span>
		</div>
	{:else}
		{#each groups as group}
			{#if group.items.length > 0}
				<!-- 分组：参考项目 settings-group-title（17px/600）+ 两列字段网格 -->
				<section class="secrets-group">
					<h2 class="settings-group-title">
						<span>{i18n(I18nKey[group.labelKey])}</span>
						<span class="group-hint">{i18n(I18nKey[group.descKey])}</span>
					</h2>

					<div class="settings-field-grid">
						{#each group.items as item (item.key)}
							<div class="settings-field" class:dirty={isDirty(item)}>
								<span class="field-label">
									{#if item.sensitive}
										<Icon icon="material-symbols:lock-outline" class="lock-icon" />
									{/if}
									<span>{item.label}</span>
									{#if item.required}<span class="req-star">*</span>{/if}
									{#if !item.configured && !item.managed}
										<span class="summary-warn">{i18n(I18nKey.secretsNotConfigured)}</span>
									{/if}
								</span>

								<p class="field-note">{item.description}</p>

								{#if item.managed}
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
											class="btn btn-sm"
											disabled={!writable || loading || rotating === item.key}
											title={writable
												? i18n(I18nKey.secretsRotateHint)
												: i18n(I18nKey.secretsRotateReadonly)}
											onclick={() => rotate(item)}
										>
											<Icon icon="material-symbols:update-rounded" />
											<span>
												{rotating === item.key
													? i18n(I18nKey.secretsRotating)
													: i18n(I18nKey.secretsRotate)}
											</span>
										</button>
									</div>
								{:else if item.kind === "multiline"}
									{#if drafts[item.key]}
										<div class="uploaded-card">
											<span class="uploaded-name"
												>{uploadNames[item.key] ?? i18n(I18nKey.secretsUploadedDefaultName)}</span
											>
											<span class="uploaded-note">{i18n(I18nKey.secretsUploadedNote)}</span>
										</div>
									{:else}
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

									{#if drafts[item.key]}
										<div class="settings-disclosure">
											<button
												type="button"
												class="settings-disclosure-trigger"
												aria-expanded={disclosureOpen[item.key] === true}
												aria-controls={"cred-" + item.key}
												onclick={() => toggleDisclosure(item.key)}
											>
												<span>{i18n(I18nKey.secretsCredentialActions)}</span>
												<Icon
													icon={disclosureOpen[item.key]
														? "material-symbols:keyboard-arrow-up-rounded"
														: "material-symbols:keyboard-arrow-down-rounded"}
												/>
											</button>
											<div
												id={"cred-" + item.key}
												class="settings-disclosure-content"
												data-open={disclosureOpen[item.key] === true}
											>
												<div>
													<div class="disclosure-inner">
														<button
															type="button"
															class="text-action"
															onclick={() => clearPem(item)}
														>
															{i18n(I18nKey.secretsUploadRemove)}
														</button>
													</div>
												</div>
											</div>
										</div>
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
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/each}
		{#if writable}
			<section class="generator-card">
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
						<Icon icon="material-symbols:update-rounded" />
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

	<!-- 底部保存条（参考 flare settings-savebar）：仅在可写环境且存在改动时出现 -->
	{#if writable && changedCount > 0}
		<div class="savebar" role="status">
			<div class="savebar-notice">
				<Icon icon="material-symbols:error-outline" />
				<span>{i18n(I18nKey.secretsUnsavedCount).replace("{count}", String(changedCount))}</span>
			</div>
			<div class="savebar-actions">
				<button class="sec-btn" type="button" disabled={saving} onclick={discardAll}>
					{i18n(I18nKey.secretsDiscard)}
				</button>
				<button
					class="sec-btn primary"
					type="button"
					onclick={save}
					disabled={saving || loading}
				>
					<Icon icon="material-symbols:save-outline" />
					<span>{saving ? i18n(I18nKey.secretsSaving) : i18n(I18nKey.secretsSave)}</span>
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* ── 页面内容：外壳（AdminPage 的 .admin-page）负责卡片与内边距，
	   这里只负责纵向分段，不再自带卡片外观与 padding。 */
	.secrets-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ── 底部保存条（参考 flare settings-savebar） ──
	   只在有未保存改动时出现，悬浮在内容之上，避免用户找不到保存入口。 */
	.savebar {
		position: sticky;
		bottom: 0.5rem;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.875rem 1.25rem;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--float-panel-bg) 94%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		border: 1px solid color-mix(in oklab, var(--primary) 20%, transparent);
		box-shadow: var(--shadow-card-hover);
	}

	.savebar-notice {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--warning);
	}

	.savebar-notice :global(.inline-icon) {
		flex-shrink: 0;
	}

	.savebar-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
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

	/* ── 顶部提示条 ──
	   成功态：绿色半透明底 + 同色微边框，说清「已完成 + 写入位置」；
	   未完成态：琥珀色，附缺失项列表。 */
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

	/* ── 操作栏 ──
	   遵循项目规范：不用实线边框，层级靠卡片底 + 毛玻璃表达；
	   容器圆角 16px、内边距 24px，与其余板块卡片一致。 */
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 1.5rem;
		border: 1px solid transparent;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--card-bg) 88%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.action-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--content-meta);
		min-width: 0;
	}

	.action-info strong {
		font-weight: 600;
		color: var(--deep-text);
	}

	.action-buttons {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	/* ── 按钮 ──
	   遵循项目规范：12px 圆角（--radius-xl）、无实线边框，
	   底色与悬停走 --btn-regular-bg 系列变量。 */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-xl);
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.2s ease, color 0.2s ease;
	}

	.btn:hover:not(:disabled) {
		background: var(--btn-regular-bg-hover);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 小号按钮：设计稿里 status-pill 内的「轮换」为 4px 12px / 12px 字 */
	.btn.btn-sm {
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
	}

	.btn :global(.inline-icon) {
		font-size: 0.875rem;
	}

	.btn.btn-sm :global(.inline-icon) {
		font-size: 0.75rem;
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

	/* 文本动作按钮：对齐参考页 .settings-text-action（主色文字、13px、无边框背景） */
	.text-action {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0;
		border: none;
		background: transparent;
		color: var(--primary);
		font-family: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.15s ease, opacity 0.15s ease;
	}

	.text-action:hover:not(:disabled) {
		color: var(--primary);
		opacity: 0.8;
	}

	.text-action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.text-action:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
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

	/* ── 分组板块 ──
	   参考项目 settings-group-title：17px/600，下 18px。 */
	.secrets-group {
		display: flex;
		flex-direction: column;
	}

	.secrets-group + .secrets-group {
		border-top: 1px solid var(--line-divider);
		padding-top: 1.5rem;
		margin-top: 0.5rem;
	}

	.settings-group-title {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0 0 1.125rem;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.settings-group-title .group-hint {
		font-size: 0.8125rem;
		font-weight: 400;
		color: var(--content-meta);
	}

	/* ── 两列字段网格（参考 .settings-field-grid：2 列、20px 间距） ── */
	.settings-field-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.25rem;
		align-items: start;
	}

	/* ── 单个字段（参考 .settings-field：纵向、8px 间距） ── */
	.settings-field {
		display: grid;
		align-content: start;
		gap: 0.5rem;
		min-width: 0;
	}

	/* 变更态：左侧主色细竖线，不改变字段宽度 */
	.settings-field.dirty {
		padding-left: 0.5rem;
		border-left: 2px solid color-mix(in oklab, var(--primary) 55%, transparent);
	}

	/* 标签行（参考 settings-field > label：13px、与值同色） */
	.field-label {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--deep-text);
		min-width: 0;
	}

	/* 说明：标签与输入框之间，12px 灰字 */
	.field-note {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: color-mix(in oklab, var(--content-meta) 80%, transparent);
	}

	/* 未配置标记：灰字，不用警示色 */
	.summary-warn {
		font-size: 0.75rem;
		font-weight: 400;
		color: color-mix(in oklab, var(--content-meta) 70%, transparent);
	}

	.req-star {
		color: color-mix(in oklab, var(--warning) 85%, var(--deep-text));
	}

	/* 窄屏：单列 */
	@media (max-width: 900px) {
		.settings-field-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* ── 私钥上传区 ──
	   虚线框是上传语义的必要表达（规范允许结构性虚线），
	   但圆角与底色回归项目变量：16px 容器圆角 + 前景色 8% 混卡片底。 */
	.upload-zone {
		position: relative;
		flex: 1;
		min-width: 0;
		border: 1px dashed color-mix(in oklab, var(--content-meta) 35%, transparent);
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--content-meta) 8%, var(--card-bg));
		transition: border-color 0.2s ease, background 0.2s ease;
	}

	.upload-zone:hover {
		border-color: var(--primary);
		background: color-mix(in oklab, var(--content-meta) 12%, var(--card-bg));
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

	/* ── 状态二：已上传的文件信息 ──
	   遵循项目规范：无实线边框，层级靠底色表达；
	   16px 容器圆角 + 12/16px 内边距。
	   文件名与「已安全读取」并列一行、无图标，右侧保留 × 按钮。 */
	.uploaded-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
		padding: 0.75rem 1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--content-meta) 8%, var(--card-bg));
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
		flex-shrink: 0;
	}

	/* ── 凭据操作折叠区（对齐参考项目 .settings-disclosure）──
	   低频、破坏性的操作收在此处，避免与常规编辑动作混在一起。
	   展开动画走 grid-template-rows 0fr→1fr，不需要 JS 计算高度。 */
	.settings-disclosure {
		border-top: 1px solid var(--line-divider);
		margin-top: 0.5rem;
	}

	.settings-disclosure-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.625rem;
		width: 100%;
		padding: 0.75rem 0;
		border: none;
		background: none;
		color: var(--content-meta);
		font-size: 0.8125rem;
		font-family: inherit;
		cursor: pointer;
		text-align: left;
		transition: color 0.2s ease;
	}

	.settings-disclosure-trigger:hover {
		color: var(--deep-text);
	}

	.settings-disclosure-trigger :global(.inline-icon) {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.settings-disclosure-content {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 0.24s ease;
	}

	.settings-disclosure-content[data-open="true"] {
		grid-template-rows: 1fr;
	}

	.settings-disclosure-content > div {
		overflow: hidden;
		min-height: 0;
	}

	.disclosure-inner {
		padding-bottom: 0.25rem;
	}

	/* 输入框：可见边框（WCAG 1.4.11 要求界面组件边界对相邻背景 ≥ 3:1）。
	   此前 border 透明、底色与卡片仅差 1.11:1，未聚焦时几乎看不出输入框边界。
	   实测结论：加深底色对这条标准没有帮助（仍 1.07:1），只能靠边框本身。
	   注意 --content-meta 本身带 alpha（暗色白 0.6 / 亮色黑 0.5），叠加 75% 后
	   最终 alpha 约 0.45，合成色为暗 rgb(130,130,135)=4.44:1、亮 rgb(139,140,140)=3.36:1，
	   两种模式均满足 AA。 */
	/* 完全对照参考项目 input.settings-input（settings.css:400-440）
	   + SETTINGS_FIELD_CLASS 的 px-3 / rounded-xl / text-sm：
	   42px 高、12px 圆角、左右 12px 内边距、14px 字号。
	   底色用「前景色 8% 混卡片色」——比卡片略亮，而非比卡片更暗；
	   静态态边框为 transparent，边界靠底色与 hover/focus 的逐级提亮表达。 */
	.secret-input {
		width: 100%;
		min-width: 0;
		min-height: 2.625rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid transparent;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--content-meta) 8%, var(--card-bg));
		color: var(--deep-text);
		font-size: 0.875rem;
		font-family: inherit;
		outline: none;
		box-shadow: none;
		transition:
			background-color 240ms ease,
			border-color 240ms ease,
			box-shadow 240ms ease;
		box-sizing: border-box;
	}

	.secret-input::placeholder {
		color: var(--content-meta);
		opacity: 0.65;
	}

	.secret-input:hover:not(:disabled) {
		background: color-mix(in srgb, var(--content-meta) 12%, var(--card-bg));
	}

	.secret-input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--primary) 45%, transparent);
		background: color-mix(in srgb, var(--primary) 7%, var(--card-bg));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);
	}

	.secret-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (prefers-reduced-motion: reduce) {
		.secret-input {
			transition: none;
		}
	}

	.secret-input.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		resize: vertical;
		line-height: 1.5;
	}

	/* 只有真正带显隐按钮的密码框才需要右侧留位。
	   .input-wrap 包裹了所有输入框，若用后代选择器会让普通输入框也
	   平白多出 40px 右内边距（光标区与文字缩进异常）。 */
	.input-wrap:has(.input-toggle) .secret-input {
		padding-right: 2.5rem;
	}

	/* 密码显隐按钮：对齐参考页 .settings-secret-input > button
	   （32x32 绝对定位 right:4px / top:4px）。
	   默认低透明度，不抢输入内容的注意力，悬停才提亮。 */
	.input-toggle {
		position: absolute;
		right: 0.25rem;
		top: 0.25rem;
		width: 2rem;
		height: 2rem;
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