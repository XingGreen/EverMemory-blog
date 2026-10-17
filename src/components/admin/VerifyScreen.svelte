<script lang="ts">
import { onMount } from "svelte";
import TurnstileWidget from "@/components/admin/TurnstileWidget.svelte";
import Icon from "@/components/common/Icon.svelte";
import { DARK_MODE, LIGHT_MODE } from "@/constants/constants";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { setTheme } from "@/utils/setting-utils";

let {
	onVerify,
	avatarUrl = "",
	oauthEnabled = false,
	breakglassEnabled = false,
}: {
	onVerify: (success: boolean) => void;
	avatarUrl?: string;
	oauthEnabled?: boolean;
	breakglassEnabled?: boolean;
} = $props();

let token = $state("");
let isSubmitting = $state(false);
let error = $state("");

// 深浅模式切换
let isDark = $state(false);
onMount(() => {
	isDark = document.documentElement.classList.contains("dark");
});
function toggleTheme() {
	isDark = !isDark;
	setTheme(isDark ? DARK_MODE : LIGHT_MODE);
}

// ── GitHub OAuth 登录（主方式）──
function startGithubLogin() {
	const params = new URLSearchParams(location.search);
	const next =
		params.get("next") ||
		sessionStorage.getItem("admin_redirect") ||
		"/admin/dashboard/";
	// 整页跳转到后端发起点，由它 302 到 GitHub 授权页
	location.href = `/api/admin/auth/github/?next=${encodeURIComponent(next)}`;
}

// OAuth 回调失败时以 oauth_error 查询参数带错误码回来，映射为可读提示
const OAUTH_ERRORS: Record<string, string> = {
	oauth_disabled: "GitHub 登录未配置",
	state_missing: "登录状态已失效，请重试",
	state_mismatch: "登录状态校验失败，请重试",
	code_missing: "授权未完成，请重试",
	token_exchange_failed: "与 GitHub 通信失败，请稍后重试",
	identity_fetch_failed: "无法获取 GitHub 账号信息，请重试",
	not_authorized: "该 GitHub 账号无后台访问权限",
};

// 浮动 label 状态
let tokenFocused = $state(false);

// ── Turnstile 人机验证（未配置则整个功能不启用）──
let turnstileSiteKey = $state("");
let turnstileToken = $state("");
// 自增以要求 widget 清空旧 token 并重新出题
let turnstileResetToken = $state(0);
let turnstileLoadFailed = $state(false);

async function loadTurnstileConfig() {
	try {
		const res = await fetch("/api/admin/turnstile/");
		if (!res.ok) return;
		const data = await res.json();
		if (data?.enabled && data.siteKey) {
			turnstileSiteKey = data.siteKey;
		}
	} catch {
		// 配置拉取失败视为未启用，不阻塞登录
	}
}

onMount(() => {
	loadTurnstileConfig();

	// OAuth 回调失败回跳时读取错误码并清理 URL，避免刷新重复提示
	const params = new URLSearchParams(location.search);
	const code = params.get("oauth_error");
	if (code) {
		error = OAUTH_ERRORS[code] || "GitHub 登录失败，请重试";
		params.delete("oauth_error");
		const qs = params.toString();
		history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
	}
});

async function handleSubmit() {
	if (!token.trim()) {
		error = "请输入应急登录令牌";
		return;
	}

	// 已配置验证码但尚未出题时直接拦在前端，避免一次注定失败的往返
	if (turnstileSiteKey && !turnstileLoadFailed && !turnstileToken) {
		error = "请先完成人机验证";
		return;
	}

	isSubmitting = true;
	error = "";

	try {
		const response = await fetch("/api/admin/verify/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, turnstileToken }),
		});

		const data = await response.json();

		if (response.ok && data.success) {
			onVerify(true);
			return;
		}

		error = data.message || "验证失败";
		onVerify(false);
	} catch {
		error = "网络请求失败";
		onVerify(false);
	} finally {
		isSubmitting = false;
		// token 一次性，无论成败都必须换新，否则重试会被服务端判为无效
		turnstileResetToken += 1;
	}
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" && !isSubmitting) {
		handleSubmit();
	}
}
</script>

<div class="verify-wrapper">
<style>
.ref-btn { font-size: 14px; padding: 4px 8px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px; line-height: 1.4; }
.ref-btn svg, .ref-btn .icon { width: 16px; height: 16px; }
</style>

	<div class="verify-card card-base">
		<!-- 左上角：返回首页（纯文本样式） -->
		<div class="top-left">
			<a
				class="home-link icon-btn ref-btn"
				href="/"
				title={i18n(I18nKey.adminHome)}
				aria-label={i18n(I18nKey.adminHome)}
			>
				<Icon icon="material-symbols:arrow-back-rounded" size="sm" />
				</a>
		</div>
		<!-- 右上角：深浅模式切换（仅图标） -->
		<div class="top-right">
			<button
				class="theme-toggle icon-btn md-icon-btn"
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

		<div class="verify-header">
			<div class="avatar-wrapper">
				{#if avatarUrl}
					<img src={avatarUrl} alt={i18n(I18nKey.verifyAvatarAlt)} class="avatar-img" />
				{:else}
					<Icon icon="material-symbols:person-rounded" class="avatar-icon" />
				{/if}
			</div>
			<h1>{i18n(I18nKey.verifyTitle)}</h1>
			<p class="subtitle">{i18n(I18nKey.verifySubtitle)}</p>
		</div>

		<div class="verify-form">
			{#if oauthEnabled}
				<button class="github-btn" type="button" onclick={startGithubLogin}>
					<svg
						viewBox="0 0 16 16"
						width="18"
						height="18"
						aria-hidden="true"
						fill="currentColor"
					>
						<path
							d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
						/>
					</svg>
					使用 GitHub 登录
				</button>
			{/if}

			{#if breakglassEnabled}
				{#if oauthEnabled}
					<div class="divider"><span>或</span></div>
				{/if}

				<!-- 应急登录令牌 -->
				<div class="field" class:focused={tokenFocused} class:filled={token.trim()}>
					<input
						id="verify-token"
						type="password"
						bind:value={token}
						onfocus={() => (tokenFocused = true)}
						onblur={() => (tokenFocused = false)}
						onkeydown={handleKeyDown}
						placeholder=" "
						autocomplete="off"
					/>
					<label for="verify-token">应急登录令牌</label>
				</div>

				{#if error}
					<div class="error-message">
						<Icon icon="material-symbols:error-outline" class="text-base" />
						<span>{error}</span>
					</div>
				{/if}

				{#if turnstileSiteKey}
					<TurnstileWidget
						siteKey={turnstileSiteKey}
						resetToken={turnstileResetToken}
						onToken={(t) => (turnstileToken = t)}
						onError={() => {
							turnstileLoadFailed = true;
							error = "人机验证加载失败，请刷新页面重试";
						}}
					/>
				{/if}

				<button
					class="submit-btn"
					class:loading={isSubmitting}
					onclick={handleSubmit}
					disabled={isSubmitting || !token.trim()}
				>
					{#if isSubmitting}
						<span class="spinner"></span>
						{i18n(I18nKey.verifyLoggingIn)}
					{:else}
						{i18n(I18nKey.verifyLogin)}
					{/if}
				</button>
			{:else if !oauthEnabled}
				<div class="error-message">
					<Icon icon="material-symbols:error-outline" class="text-base" />
					<span
						>未配置任何登录方式。请在 .env.local 配置 GitHub OAuth 凭据或
						ADMIN_BREAKGLASS_TOKEN。</span
					>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.verify-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 0;
	}

	.verify-card {
		position: relative;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 420px;
		box-shadow: var(--shadow-card);
		border-radius: var(--radius-large);
	}

	/* ── 卡片顶角定位 ── */
	.top-left {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
	}

	.top-right {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
	}

	.home-link {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
		text-decoration: none;
		border-radius: var(--radius-sm);
		transition: color 0.2s, background-color 0.2s;
	}

	.home-link:hover {
		color: var(--primary);
		background-color: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		border-radius: var(--radius-md);
		transition: color 0.2s, background-color 0.2s;
	}

	.theme-toggle:hover {
		color: var(--primary);
		background-color: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	.verify-header {
		text-align: center;
		margin-bottom: 2rem;
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

	.verify-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.375rem;
	}

	.subtitle {
		color: var(--content-meta);
		font-size: 0.8125rem;
	}

	.verify-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ── GitHub 登录按钮（主方式）── */
	.github-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.875rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.2s;
	}

	.github-btn:hover {
		border-color: var(--primary);
		color: var(--primary);
		transform: translateY(-1px);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--content-meta);
		font-size: 0.75rem;
	}

	.divider::before,
	.divider::after {
		content: "";
		flex: 1;
		height: 1px;
		background: var(--line-divider);
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

	/* ── 错误提示 ── */
	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: color-mix(in srgb, var(--destructive) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--destructive) 30%, transparent);
		border-radius: var(--radius-sm);
		color: var(--destructive);
		font-size: 0.8125rem;
	}

	/* ── 登录按钮 ── */
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
		margin-top: 0.25rem;
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
		background: var(--muted);
		color: var(--content-meta);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
