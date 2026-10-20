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
// 每个密钥的输入草稿：非敏感回显当前值；敏感值永不下发，输入新值即覆盖
let drafts = $state<Record<string, string>>({});
// 标记待清除的密钥
let toDelete = $state<Record<string, boolean>>({});
// 密码类输入框的显隐切换
let showInput = $state<Record<string, boolean>>({});
// 导出弹窗
let exportOpen = $state(false);
let exportBusy = $state(false);
// 正在轮换的托管密钥 key（用于按钮 loading 态）
let rotating = $state("");

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
	if (toDelete[item.key]) return true;
	const draft = (drafts[item.key] ?? "").trim();
	if (item.sensitive) return draft !== "";
	return draft !== (item.preview ?? "");
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
			drafts = {};
			toDelete = {};
			showInput = {};
			for (const item of items) {
				drafts[item.key] = item.sensitive ? "" : (item.preview ?? "");
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

function buildEntries(): { key: string; value?: string; delete?: boolean }[] {
	const entries: { key: string; value?: string; delete?: boolean }[] = [];
	for (const item of items) {
		if (toDelete[item.key]) {
			entries.push({ key: item.key, delete: true });
			continue;
		}
		const draft = (drafts[item.key] ?? "").trim();
		if (item.sensitive) {
			if (draft) entries.push({ key: item.key, value: draft });
		} else if (draft !== (item.preview ?? "")) {
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

function toggleClear(item: SecretItemDTO) {
	if (!item.configured) return;
	toDelete[item.key] = !toDelete[item.key];
	if (toDelete[item.key]) {
		drafts[item.key] = "";
	} else if (!item.sensitive) {
		drafts[item.key] = item.preview ?? "";
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
		<div class="secrets-status" class:all-done={allRequiredConfigured}>
			{#if allRequiredConfigured}
				<Icon icon="material-symbols:task-alt" class="status-icon" />
				<span class="status-text">{i18n(I18nKey.secretsStatusAllDone)}</span>
			{:else}
				<Icon icon="material-symbols:info-outline" class="status-icon" />
				<span class="status-text">
					{i18n(I18nKey.secretsStatusPartial)
						.replace("{done}", String(requiredConfiguredCount))
						.replace("{total}", String(requiredItems.length))}
				</span>
				<span class="status-missing">
					{i18n(I18nKey.secretsStatusMissing)}
					{#each missingRequired as item, i (item.key)}
						<span class="status-key" title={item.key}>
							{item.label}
							<code class="status-key-code">{item.key}</code>
						</span>
						{#if i < missingRequired.length - 1}、{/if}
					{/each}
				</span>
			{/if}
		</div>
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
							<div
								class="secret-field"
								class:dirty={isDirty(item)}
								class:pending-delete={toDelete[item.key]}
							>
								<div class="field-head">
									<h3 title={item.key}>
										{#if item.sensitive}
											<Icon icon="material-symbols:lock-outline" class="lock-icon" />
										{/if}
										<span>{item.label}</span>
										{#if item.required}<span class="req-star">*</span>{/if}
									</h3>
									{#if toDelete[item.key]}
										<span class="badge pending">{i18n(I18nKey.secretsPendingDelete)}</span>
									{:else if item.configured}
										<span class="badge ok">{i18n(I18nKey.secretsConfigured)}</span>
									{:else}
										<span class="badge missing">{i18n(I18nKey.secretsNotConfigured)}</span>
									{/if}
								</div>

								<p class="field-desc">{item.description}</p>

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
									<div class="field-input-row">
									{#if item.kind === "multiline"}
										<textarea
											class="secret-input mono"
											rows="4"
											spellcheck="false"
											value={drafts[item.key] ?? ""}
											placeholder={item.configured
												? i18n(I18nKey.secretsPlaceholderConfigured)
												: i18n(I18nKey.secretsPlaceholderEmpty)}
											disabled={!writable || toDelete[item.key] || loading}
											oninput={(e) => (drafts[item.key] = e.currentTarget.value)}
										></textarea>
									{:else if item.kind === "password"}
										<div class="input-wrap">
<input
											class="secret-input"
											type={showInput[item.key] ? "text" : "password"}
											value={drafts[item.key] ?? ""}
											spellcheck="false"
											name="secret-draft"
											autocomplete="new-password"
												placeholder={item.configured
													? i18n(I18nKey.secretsPlaceholderConfigured)
													: i18n(I18nKey.secretsPlaceholderEmpty)}
												disabled={!writable || toDelete[item.key] || loading}
												oninput={(e) => (drafts[item.key] = e.currentTarget.value)}
											/>
											<button
												type="button"
												class="input-toggle"
												title={showInput[item.key]
													? i18n(I18nKey.secretsHide)
													: i18n(I18nKey.secretsShow)}
												aria-label={showInput[item.key]
													? i18n(I18nKey.secretsHide)
													: i18n(I18nKey.secretsShow)}
												onclick={() => (showInput[item.key] = !showInput[item.key])}
												disabled={!writable}
											>
												<Icon
													icon={showInput[item.key]
														? "material-symbols:lock-outline"
														: "material-symbols:visibility-outline-rounded"}
												/>
											</button>
										</div>
									{:else}
										<input
											class="secret-input"
											type="text"
											value={drafts[item.key] ?? ""}
											spellcheck="false"
											placeholder={item.configured
												? i18n(I18nKey.secretsPlaceholderConfigured)
												: i18n(I18nKey.secretsPlaceholderEmpty)}
											disabled={!writable || toDelete[item.key] || loading}
											oninput={(e) => (drafts[item.key] = e.currentTarget.value)}
										/>
									{/if}

									{#if writable}
										<button
											type="button"
											class="clear-btn"
											title={i18n(I18nKey.secretsClear)}
											aria-label={i18n(I18nKey.secretsClear)}
											disabled={!item.configured || loading}
											onclick={() => toggleClear(item)}
										>
											<Icon
												icon={toDelete[item.key]
													? "material-symbols:check"
													: "material-symbols:close"}
											/>
										</button>
									{/if}
								</div>
								{/if}

								<code class="field-key">{item.key}</code>
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

	/* ── 配置完成度状态卡 ──
	   半透明底色 + 彩色文字 + 微弱同色边框；不再与 --card-bg 混色，
	   否则暗色下会变成一块实心暗绿。 */
	.secrets-status {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
		padding: 1rem 1.25rem;
		border-radius: var(--radius-large);
		background: color-mix(in oklab, var(--warning) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--warning) 22%, transparent);
		color: var(--warning);
		font-size: 0.875rem;
	}

	.secrets-status.all-done {
		background: color-mix(in oklab, var(--success) 10%, transparent);
		border-color: color-mix(in oklab, var(--success) 22%, transparent);
		color: var(--success);
	}

	.secrets-status :global(.status-icon) {
		color: var(--warning);
		flex-shrink: 0;
	}

	.secrets-status.all-done :global(.status-icon) {
		color: var(--success);
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
	   参考设计：字段在板块内纵向排列，标签/状态一行、说明在其下、输入框整行。
	   字段本身不是卡片容器，只用间距和极淡的分隔线区分，避免卡片套卡片。 */
	.secret-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.secret-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		/* 无背景、无边框、无圆角：它就是板块内容本身，不是独立卡片 */
		padding: 0;
		border: 0;
		background: transparent;
	}

	/* 变更/待删除只在左侧留一道细指示线，不恢复整块卡片观感 */
	.secret-field.dirty {
		padding-left: 0.875rem;
		border-left: 2px solid color-mix(in oklab, var(--primary) 55%, transparent);
	}

	.secret-field.pending-delete {
		padding-left: 0.875rem;
		border-left: 2px solid color-mix(in oklab, var(--destructive) 55%, transparent);
		opacity: 0.75;
	}

	/* 标签行：标题在左、配置状态在右 */
	.field-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.field-head h3 {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
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

	/* 状态标签：取消背景色块，只保留彩色文字 */
	.badge {
		flex-shrink: 0;
		padding: 0;
		background: transparent;
		border-radius: 0;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.6;
	}

	.badge.ok {
		color: var(--success);
	}

	.badge.missing {
		color: var(--warning);
	}

	.badge.pending {
		color: var(--destructive);
	}

	.field-desc {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.55;
	}

	.field-input-row {
		display: flex;
		align-items: stretch;
		gap: 0.5rem;
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

	/* 清除按钮：同样弱化为低透明度图标，避免与主操作用户抢焦点 */
	.clear-btn {
		flex-shrink: 0;
		width: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: var(--radius-xl);
		background: color-mix(in oklab, var(--page-bg) 55%, var(--card-bg));
		color: var(--content-meta);
		opacity: 0.55;
		cursor: pointer;
		transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
	}

	.clear-btn:hover:not(:disabled) {
		opacity: 1;
		color: var(--destructive);
		background: color-mix(in oklab, var(--destructive) 8%, transparent);
	}

	.clear-btn:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	/* 环境变量名：去掉背景色块，改成极低对比度的纯文本。
	   紧随输入框之后（不再 margin-top:auto），间距由卡片 gap 统一分配。 */
	.field-key {
		padding: 0;
		font-size: 0.75rem;
		font-family: var(--font-mono, monospace);
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