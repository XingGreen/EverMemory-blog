<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	type AdminSecretItem,
	getSecretItem,
	SECRET_GROUPS,
} from "@/utils/admin-secrets";

type SecretItemDTO = AdminSecretItem & {
	configured: boolean;
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
// 生成工具：明文密码
let plainPassword = $state("");
// 导出弹窗
let exportOpen = $state(false);
let exportBusy = $state(false);
// 修改认证信息前的当前密码确认
let authConfirmOpen = $state(false);
let currentPassword = $state("");
let pendingEntries: { key: string; value?: string; delete?: boolean }[] = [];

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
	// 涉及管理员认证（用户名 / 密码 / JWT）：先验证当前登录密码
	const touchesAuth = entries.some(
		(entry) => getSecretItem(entry.key)?.group === "auth",
	);
	if (touchesAuth) {
		pendingEntries = entries;
		currentPassword = "";
		authConfirmOpen = true;
		return;
	}
	await doSave(entries, "");
}

async function doSave(
	entries: { key: string; value?: string; delete?: boolean }[],
	password: string,
) {
	saving = true;
	try {
		const res = await fetch("/api/admin/secrets/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entries, currentPassword: password }),
		});
		const data = await res.json();
		if (data.success) {
			onNotify(data.message || "保存成功", "success", 10000);
			await load();
		} else {
			onNotify(data.message || "保存失败", "error", 10000);
		}
	} catch (err) {
		onNotify(
			`保存请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			10000,
		);
	} finally {
		saving = false;
		authConfirmOpen = false;
		currentPassword = "";
		pendingEntries = [];
	}
}

function confirmAuthSave() {
	if (!currentPassword.trim()) {
		onNotify(
			`${i18n(I18nKey.secretsAuthConfirmPlaceholder)}不能为空`,
			"error",
			5000,
		);
		return;
	}
	doSave(pendingEntries, currentPassword);
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

async function generateJwt() {
	try {
		const res = await fetch("/api/admin/secrets/generate/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "jwt" }),
		});
		const data = await res.json();
		if (data.success) {
			drafts.ADMIN_JWT_SECRET = data.value;
			toDelete.ADMIN_JWT_SECRET = false;
			onNotify(i18n(I18nKey.secretsGenerateJwtDone), "success", 8000);
		} else {
			onNotify(data.message || "生成失败", "error", 8000);
		}
	} catch (err) {
		onNotify(
			`生成请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			8000,
		);
	}
}

async function generateHash() {
	const password = plainPassword.trim();
	if (!password) return;
	try {
		const res = await fetch("/api/admin/secrets/generate/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "password", password }),
		});
		const data = await res.json();
		if (data.success) {
			drafts.ADMIN_PASSWORD = data.value;
			toDelete.ADMIN_PASSWORD = false;
			plainPassword = "";
			onNotify(i18n(I18nKey.secretsGenerateHashDone), "success", 8000);
		} else {
			onNotify(data.message || "生成失败", "error", 8000);
		}
	} catch (err) {
		onNotify(
			`生成请求失败: ${err instanceof Error ? err.message : String(err)}`,
			"error",
			8000,
		);
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
				<section class="secrets-group">
					<h2 class="group-title">
						<Icon icon={group.icon} class="group-icon" />
						<span>
							{i18n(
								group.id === "github"
									? I18nKey.secretsGroupGithub
									: I18nKey.secretsGroupAuth,
							)}
						</span>
						<span class="group-count">{group.items.length}</span>
					</h2>
					<div class="secret-grid">
						{#each group.items as item (item.key)}
							<article
								class="card-base secret-field"
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

								<code class="field-key">{item.key}</code>
							</article>
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
					<button class="sec-btn" onclick={generateJwt} disabled={saving}>
						<Icon icon="material-symbols:auto-awesome" />
						<span>{i18n(I18nKey.secretsGenerateJwt)}</span>
					</button>
				</div>
				<div class="generator-row">
					<span class="gen-label">{i18n(I18nKey.secretsPasswordInput)}</span>
					<div class="input-wrap gen-password">
						<input
							class="secret-input"
							type="password"
							bind:value={plainPassword}
							placeholder={i18n(I18nKey.secretsPasswordPlaceholder)}
							autocomplete="off"
						/>
					</div>
					<button
						class="sec-btn"
						onclick={generateHash}
						disabled={saving || !plainPassword.trim()}
					>
						<Icon icon="material-symbols:shield-lock" />
						<span>{i18n(I18nKey.secretsGenerateHash)}</span>
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

	{#if authConfirmOpen}
		<div
			class="modal-overlay"
			role="dialog"
			aria-modal="true"
			aria-label={i18n(I18nKey.secretsAuthConfirmTitle)}
			tabindex="-1"
			onclick={(e) => {
				if (e.target === e.currentTarget && !saving) authConfirmOpen = false;
			}}
			onkeydown={(e) => {
				if (e.key === "Escape" && !saving) authConfirmOpen = false;
			}}
		>
			<div class="modal-card card-base">
				<div class="modal-head">
					<h3>
						<Icon icon="material-symbols:shield-lock" class="modal-head-icon" />
						<span>{i18n(I18nKey.secretsAuthConfirmTitle)}</span>
					</h3>
					<button
						class="modal-close"
						type="button"
						aria-label={i18n(I18nKey.secretsClose)}
						onclick={() => !saving && (authConfirmOpen = false)}
					>
						<Icon icon="material-symbols:close" />
					</button>
				</div>
				<p class="modal-desc">{i18n(I18nKey.secretsAuthConfirmDesc)}</p>
				<div class="modal-field">
					<input
						type="password"
						class="secret-input"
						value={currentPassword}
						placeholder={i18n(I18nKey.secretsAuthConfirmPlaceholder)}
						autocomplete="current-password"
						oninput={(e) => (currentPassword = e.currentTarget.value)}
						onkeydown={(e) => {
							if (e.key === "Enter") confirmAuthSave();
						}}
					/>
				</div>
				<div class="modal-actions">
					<button
						class="sec-btn modal-cancel"
						onclick={() => (authConfirmOpen = false)}
						disabled={saving}
					>
						{i18n(I18nKey.secretsCancel)}
					</button>
					<button
						class="sec-btn primary"
						onclick={confirmAuthSave}
						disabled={saving}
					>
						<Icon icon="material-symbols:shield-lock" />
						<span
							>{saving
								? i18n(I18nKey.secretsSaving)
								: i18n(I18nKey.secretsAuthConfirmSubmit)}</span
						>
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
		background: color-mix(in srgb, var(--destructive) 10%, var(--card-bg));
		color: var(--destructive);
		border: 1px solid color-mix(in srgb, var(--destructive) 30%, transparent);
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

	/* ── 配置完成度状态卡 ── */
	.secrets-status {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
		padding: 0.875rem 1.125rem;
		border-radius: var(--radius-large);
		background: color-mix(in srgb, var(--warning) 10%, var(--card-bg));
		border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
		color: var(--deep-text);
		font-size: 0.875rem;
	}

	.secrets-status.all-done {
		background: color-mix(in srgb, var(--success) 10%, var(--card-bg));
		border-color: color-mix(in srgb, var(--success) 30%, transparent);
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
		padding: 0.1875rem 0.625rem;
		border-radius: 999px;
		background: var(--btn-regular-bg);
		font-size: 0.8125rem;
		color: var(--deep-text);
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
		padding: 1rem 1.25rem;
		flex-wrap: wrap;
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
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
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

	/* ── 分组 ── */
	.secrets-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.group-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.group-title::before {
		content: "";
		width: 3px;
		height: 1.1em;
		border-radius: 999px;
		background: var(--primary);
		flex-shrink: 0;
	}

	:global(.group-icon) {
		color: var(--primary);
	}

	.group-count {
		margin-left: auto;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--content-meta);
		background: var(--btn-regular-bg);
		border-radius: 999px;
		font-family: var(--font-mono, monospace);
	}

	/* ── 密钥卡片 ── */
	.secret-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 1rem;
	}

	.secret-field {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		border: 1px solid var(--line-divider);
		transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
	}

	.secret-field:hover {
		border-color: color-mix(in srgb, var(--primary) 40%, var(--line-divider));
	}

	.secret-field.dirty {
		border-color: var(--primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent);
	}

	.secret-field.pending-delete {
		border-color: var(--destructive);
		opacity: 0.75;
	}

	.field-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
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

	.badge {
		flex-shrink: 0;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.6;
	}

	.badge.ok {
		background: color-mix(in srgb, var(--success) 14%, transparent);
		color: var(--success);
	}

	.badge.missing {
		background: color-mix(in srgb, var(--warning) 14%, transparent);
		color: var(--warning);
	}

	.badge.pending {
		background: color-mix(in srgb, var(--destructive) 14%, transparent);
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

	.input-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
	}

	.secret-input {
		width: 100%;
		min-width: 0;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		background: var(--page-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		font-family: inherit;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
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
		border-color: var(--primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent);
	}

	.secret-input::placeholder {
		color: var(--content-meta);
		opacity: 0.75;
	}

	.secret-input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.input-wrap .secret-input {
		padding-right: 2.5rem;
	}

	.input-toggle {
		position: absolute;
		right: 0.375rem;
		width: 1.75rem;
		height: 1.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.input-toggle:hover:not(:disabled) {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	.input-toggle:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.clear-btn {
		flex-shrink: 0;
		width: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		transition: all 0.2s;
	}

	.clear-btn:hover:not(:disabled) {
		color: var(--destructive);
		border-color: color-mix(in srgb, var(--destructive) 40%, transparent);
	}

	.clear-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.field-key {
		font-size: 0.6875rem;
		font-family: var(--font-mono, monospace);
		color: var(--content-meta);
		background: var(--btn-regular-bg);
		padding: 0.1875rem 0.5rem;
		border-radius: var(--radius-sm);
		align-self: flex-start;
	}

	/* ── 生成工具 ── */
	.generator-card {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		border: 1px dashed color-mix(in srgb, var(--primary) 40%, var(--line-divider));
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
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(2px);
		padding: 1rem;
	}

	.modal-card {
		width: 100%;
		max-width: 440px;
		padding: 1.5rem;
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
		background: rgba(0, 0, 0, 0.05);
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
		padding: 0.625rem 0.875rem;
		background: rgba(249, 115, 22, 0.1);
		border: 1px solid rgba(249, 115, 22, 0.3);
		border-radius: var(--radius-sm);
		color: #f97316;
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