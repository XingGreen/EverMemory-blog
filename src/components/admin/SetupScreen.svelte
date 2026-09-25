<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { DARK_MODE, LIGHT_MODE } from "@/constants/constants";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { setTheme } from "@/utils/setting-utils";

let {
	avatarUrl = "",
	defaultUsername = "admin",
	tokenRequired = true,
	writable = true,
	onComplete,
}: {
	avatarUrl?: string;
	defaultUsername?: string;
	tokenRequired?: boolean;
	writable?: boolean;
	onComplete: () => void;
} = $props();

let token = $state("");
// svelte-ignore state_referenced_locally —— 仅取 defaultUsername 的初始值回填，无需随 prop 同步
let username = $state(defaultUsername);
let password = $state("");
let confirm = $state("");
let isSubmitting = $state(false);
let error = $state("");
let successMsg = $state("");
let showPassword = $state(false);

// 两段式：先验证安装令牌，通过后再填写账号信息
let verified = $state(false);
let verifyingToken = $state(false);

let isDark = $state(false);
onMount(() => {
	isDark = document.documentElement.classList.contains("dark");
});
function toggleTheme() {
	isDark = !isDark;
	setTheme(isDark ? DARK_MODE : LIGHT_MODE);
}

// 浮动 label 状态
let tokenFocused = $state(false);
let usernameFocused = $state(false);
let passwordFocused = $state(false);
let confirmFocused = $state(false);

function validate(): string {
	if (!username.trim()) {
		return `${i18n(I18nKey.adminSetupUsernameLabel)}不能为空`;
	}
	if (password.length < 8 || password === username.trim()) {
		return i18n(I18nKey.adminSetupPasswordWeak);
	}
	if (password !== confirm) {
		return i18n(I18nKey.adminSetupPasswordMismatch);
	}
	return "";
}

async function verifyToken() {
	if (!token.trim()) {
		error = `${i18n(I18nKey.adminSetupTokenLabel)}不能为空`;
		return;
	}
	verifyingToken = true;
	error = "";
	try {
		const response = await fetch("/api/admin/setup/verify-token/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});
		const data = await response.json();
		if (response.ok && data.success) {
			verified = true;
		} else {
			error = data.message || "令牌验证失败";
		}
	} catch {
		error = "网络请求失败";
	} finally {
		verifyingToken = false;
	}
}

async function handleSubmit() {
	const issue = validate();
	if (issue) {
		error = issue;
		return;
	}

	isSubmitting = true;
	error = "";
	successMsg = "";

	try {
		const response = await fetch("/api/admin/setup/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username, password }),
		});
		const data = await response.json();

		if (response.ok && data.success) {
			successMsg = data.message || i18n(I18nKey.adminSetupDone);
			// 短暂展示成功提示后自动进入控制台
			setTimeout(onComplete, 1200);
		} else {
			error = data.message || "初始化失败";
		}
	} catch {
		error = "网络请求失败";
	} finally {
		isSubmitting = false;
	}
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key !== "Enter" || isSubmitting) return;
	if (tokenRequired && !verified) {
		verifyToken();
	} else {
		handleSubmit();
	}
}

function handleTokenKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" && !verifyingToken) {
		verifyToken();
	}
}
</script>

<div class="setup-wrapper">
	<div class="setup-card card-base">
		<!-- 右上角：返回首页 + 深浅模式切换 -->
		<div class="top-actions">
			<a
				class="action-btn"
				href="/"
				title={i18n(I18nKey.adminHome)}
				aria-label={i18n(I18nKey.adminHome)}
			>
				<Icon icon="material-symbols:home-outline-rounded" size="md" />
			</a>
			<button
				class="action-btn"
				type="button"
				title={isDark ? i18n(I18nKey.lightMode) : i18n(I18nKey.darkMode)}
				aria-label={isDark ? i18n(I18nKey.lightMode) : i18n(I18nKey.darkMode)}
				onclick={toggleTheme}
			>
				{#if isDark}
					<Icon icon="material-symbols:wb-sunny-outline-rounded" size="md" />
				{:else}
					<Icon icon="material-symbols:dark-mode-outline-rounded" size="md" />
				{/if}
			</button>
		</div>

		{#if !writable}
			<!-- 只读环境：无法在此设置，提示去部署平台 -->
			<div class="setup-header">
				<div class="avatar-wrapper">
					<Icon icon="material-symbols:cloud-off-outline" class="avatar-icon" />
				</div>
				<h1>{i18n(I18nKey.adminSetupTitle)}</h1>
				<p class="subtitle">{i18n(I18nKey.adminSetupDesc)}</p>
			</div>
			<div class="readonly-hint">
				<Icon icon="material-symbols:error-outline" size="lg" />
				<span>{i18n(I18nKey.adminSetupReadonly)}</span>
			</div>
		{:else}
			<div class="setup-header">
				<div class="avatar-wrapper">
					{#if avatarUrl}
						<img
							src={avatarUrl}
							alt={i18n(I18nKey.verifyAvatarAlt)}
							class="avatar-img"
						/>
					{:else}
						<Icon icon="material-symbols:lock-person-rounded" class="avatar-icon" />
					{/if}
				</div>
				<h1>{i18n(I18nKey.adminSetupTitle)}</h1>
				<p class="subtitle">{i18n(I18nKey.adminSetupDesc)}</p>
			</div>

<div class="setup-form">
			{#if tokenRequired && !verified}
				<!-- 第一步：输入安装令牌（从服务端终端日志获取） -->
				<div class="field" class:focused={tokenFocused} class:filled={token.trim()}>
					<input
						id="setup-token"
						type={showPassword ? "text" : "password"}
						bind:value={token}
						onfocus={() => (tokenFocused = true)}
						onblur={() => (tokenFocused = false)}
						onkeydown={handleTokenKeyDown}
						placeholder=" "
						autocomplete="off"
						class="password-input"
					/>
					<label for="setup-token">{i18n(I18nKey.adminSetupTokenLabel)}</label>
					<button
						type="button"
						class="password-toggle"
						title={showPassword ? i18n(I18nKey.secretsHide) : i18n(I18nKey.secretsShow)}
						aria-label={showPassword ? i18n(I18nKey.secretsHide) : i18n(I18nKey.secretsShow)}
						onclick={() => (showPassword = !showPassword)}
					>
						<Icon
							icon={showPassword
								? "material-symbols:visibility-off-outline-rounded"
								: "material-symbols:visibility-outline-rounded"}
							size="sm"
						/>
					</button>
				</div>
				<p class="field-hint">
					<Icon icon="material-symbols:terminal-rounded" size="sm" />
					<span>{i18n(I18nKey.adminSetupTokenHint)}</span>
				</p>

				{#if error}
					<div class="error-message">
						<Icon icon="material-symbols:error-outline" class="text-base" />
						<span>{error}</span>
					</div>
				{/if}

				<button
					class="submit-btn"
					class:loading={verifyingToken}
					onclick={verifyToken}
					disabled={verifyingToken || !token.trim()}
				>
					{#if verifyingToken}
						<span class="spinner"></span>
						{i18n(I18nKey.adminSetupVerifying)}
					{:else}
						<Icon icon="material-symbols:shield-lock" size="sm" />
						{i18n(I18nKey.adminSetupVerifyToken)}
					{/if}
				</button>
			{:else}
				<!-- 第一步已通过：令牌确认条 + 账号信息表单 -->
				{#if tokenRequired}
					<div class="token-verified">
						<span class="token-ok">
							<Icon icon="material-symbols:check-circle-outline" size="sm" />
							{i18n(I18nKey.adminSetupTokenVerified)}
						</span>
						<button
							type="button"
							class="token-back"
							onclick={() => {
								verified = false;
								error = "";
							}}
						>
							{i18n(I18nKey.adminSetupTokenBack)}
						</button>
					</div>
				{/if}

				<div class="field" class:focused={usernameFocused} class:filled={username.trim()}>
					<input
						id="setup-username"
						type="text"
						bind:value={username}
						onfocus={() => (usernameFocused = true)}
						onblur={() => (usernameFocused = false)}
						onkeydown={handleKeyDown}
						placeholder=" "
						autocomplete="username"
					/>
					<label for="setup-username">{i18n(I18nKey.adminSetupUsernameLabel)}</label>
				</div>

				<div class="field" class:focused={passwordFocused} class:filled={password.trim()}>
					<input
						id="setup-password"
						type={showPassword ? "text" : "password"}
						bind:value={password}
						onfocus={() => (passwordFocused = true)}
						onblur={() => (passwordFocused = false)}
						onkeydown={handleKeyDown}
						placeholder=" "
						autocomplete="new-password"
						class="password-input"
					/>
					<label for="setup-password">{i18n(I18nKey.adminSetupPasswordLabel)}</label>
					<button
						type="button"
						class="password-toggle"
						title={showPassword ? i18n(I18nKey.secretsHide) : i18n(I18nKey.secretsShow)}
						aria-label={showPassword ? i18n(I18nKey.secretsHide) : i18n(I18nKey.secretsShow)}
						onclick={() => (showPassword = !showPassword)}
					>
						<Icon
							icon={showPassword
								? "material-symbols:visibility-off-outline-rounded"
								: "material-symbols:visibility-outline-rounded"}
							size="sm"
						/>
					</button>
				</div>

				<div class="field" class:focused={confirmFocused} class:filled={confirm.trim()}>
					<input
						id="setup-confirm"
						type={showPassword ? "text" : "password"}
						bind:value={confirm}
						onfocus={() => (confirmFocused = true)}
						onblur={() => (confirmFocused = false)}
						onkeydown={handleKeyDown}
						placeholder=" "
						autocomplete="new-password"
						class="password-input"
					/>
					<label for="setup-confirm">{i18n(I18nKey.adminSetupConfirmLabel)}</label>
				</div>

				{#if error}
					<div class="error-message">
						<Icon icon="material-symbols:error-outline" class="text-base" />
						<span>{error}</span>
					</div>
				{/if}

				{#if successMsg}
					<div class="success-message">
						<Icon icon="material-symbols:check-circle-outline" class="text-base" />
						<span>{successMsg}</span>
					</div>
				{/if}

				<button
					class="submit-btn"
					class:loading={isSubmitting}
					onclick={handleSubmit}
					disabled={isSubmitting || successMsg}
				>
					{#if isSubmitting}
						<span class="spinner"></span>
						{i18n(I18nKey.adminSetupSubmitting)}
					{:else if successMsg}
						<Icon icon="material-symbols:check" size="sm" />
						{i18n(I18nKey.adminSetupDone)}
					{:else}
						{i18n(I18nKey.adminSetupSubmit)}
					{/if}
				</button>
			{/if}
		</div>
		{/if}
	</div>
</div>

<style>
	.setup-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 0;
	}

	.setup-card {
		position: relative;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 420px;
		box-shadow: var(--shadow-card);
		border-radius: var(--radius-large);
	}

	/* ── 右上角操作按钮：返回首页 + 深浅切换 ── */
	.top-actions {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid var(--line-divider);
		border-radius: 50%;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
	}

	.action-btn:hover {
		color: var(--primary);
		border-color: var(--primary);
	}

	.setup-header {
		text-align: center;
		margin-bottom: 1.75rem;
	}

	.avatar-wrapper {
		width: 4.5rem;
		height: 4.5rem;
		margin: 0 auto 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--primary);
		color: var(--primary-foreground);
		border-radius: 50%;
		overflow: hidden;
		box-shadow: var(--shadow-button);
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 50%;
	}

	:global(.avatar-icon) {
		font-size: 2rem;
	}

	.setup-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.375rem;
	}

	.subtitle {
		color: var(--content-meta);
		font-size: 0.8125rem;
	}

	.setup-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ── 浮动 label 输入框 ── */
	.field {
		position: relative;
	}

	.field input {
		width: 100%;
		padding: 1rem 0.75rem 0.5rem;
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		transition: border-color 0.2s;
		background: var(--card-bg);
		color: var(--deep-text);
		font-family: inherit;
	}

	.field input:focus {
		outline: none;
		border-color: var(--primary);
		border-width: 2px;
		padding: calc(1rem - 1px) calc(0.75rem - 1px) calc(0.5rem - 1px);
	}

	.field label {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.9375rem;
		color: var(--content-meta);
		pointer-events: none;
		transition: all 0.18s ease;
	}

	.field.focused label,
	.field.filled label {
		top: 0;
		transform: translateY(-50%) scale(0.8);
		color: var(--primary);
		background: var(--card-bg);
		padding: 0 0.25rem;
	}

	.field input:-webkit-autofill ~ label {
		top: 0;
		transform: translateY(-50%) scale(0.8);
		color: var(--primary);
		background: var(--card-bg);
		padding: 0 0.25rem;
	}

	.field.focused input {
		border-color: var(--primary);
	}

	.field input:-webkit-autofill {
		-webkit-text-fill-color: var(--deep-text);
		-webkit-box-shadow: 0 0 0 1000px var(--card-bg) inset;
		transition: background-color 9999s ease-in-out 0s;
	}

	/* ── 密码可见切换 ── */
	.password-input,
	.field input.password-input:focus {
		padding-right: 2.75rem;
	}

	.password-toggle {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
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
		padding: 0;
		transition: color 0.2s;
	}

	.password-toggle:hover {
		color: var(--primary);
	}

	/* ── 字段提示 ── */
	.field-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: -0.75rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		line-height: 1.5;
	}

	.field-hint :global(svg) {
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	/* ── 令牌验证通过提示条 ── */
	.token-verified {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
	}

	.token-ok {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: #22c55e;
	}

	.token-back {
		border: none;
		background: transparent;
		color: var(--content-meta);
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
	}

	.token-back:hover {
		color: var(--primary);
	}

	/* ── 错误 / 成功提示 ── */
	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: var(--radius-sm);
		color: #ef4444;
		font-size: 0.8125rem;
	}

	.success-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		border-radius: var(--radius-sm);
		color: #22c55e;
		font-size: 0.8125rem;
	}

	/* ── 只读提示 ── */
	.readonly-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 1rem 1.125rem;
		background: rgba(249, 115, 22, 0.1);
		border: 1px solid rgba(249, 115, 22, 0.3);
		border-radius: var(--radius-md);
		color: #f97316;
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.readonly-hint :global(svg) {
		flex-shrink: 0;
		margin-top: 0.25rem;
	}

	/* ── 提交按钮 ── */
	.submit-btn {
		padding: 0.875rem;
		border: none;
		border-radius: var(--radius-large);
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		font-family: inherit;
		box-shadow: var(--shadow-button);
	}

	.submit-btn:hover:not(:disabled) {
		filter: brightness(1.05);
		transform: translateY(-1px);
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.submit-btn.loading {
		background: var(--line-divider);
		color: var(--content-meta);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: setup-spin 0.8s linear infinite;
	}

	@keyframes setup-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>