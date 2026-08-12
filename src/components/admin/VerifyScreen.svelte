<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { onMount } from "svelte";
import { DARK_MODE, LIGHT_MODE } from "@/constants/constants";
import { setTheme } from "@/utils/setting-utils";

let {
	onVerify,
	avatarUrl = "",
}: { onVerify: (success: boolean) => void; avatarUrl?: string } = $props();

let username = $state("");
let password = $state("");
let isSubmitting = $state(false);
let error = $state("");
let rememberMe = $state(false);
let showPassword = $state(false);

// 深浅模式切换
let isDark = $state(false);
onMount(() => {
	isDark = document.documentElement.classList.contains("dark");
});
function toggleTheme() {
	isDark = !isDark;
	setTheme(isDark ? DARK_MODE : LIGHT_MODE);
}

// 浮动 label 状态
let usernameFocused = $state(false);
let passwordFocused = $state(false);

async function handleSubmit() {
	const missing: string[] = [];
	if (!username.trim()) missing.push(i18n(I18nKey.verifyUsername));
	if (!password.trim()) missing.push(i18n(I18nKey.verifyPassword));

	if (missing.length > 0) {
		error = i18n(I18nKey.errorFillRequired).replace(
			"{fields}",
			missing.join("、"),
		);
		return;
	}

	isSubmitting = true;
	error = "";

	try {
		const response = await fetch("/api/admin/verify/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password, rememberMe }),
		});

		const data = await response.json();

		if (response.ok && data.success) {
			onVerify(true);
		} else {
			error = data.message || "验证失败";
			onVerify(false);
		}
	} catch {
		error = "网络请求失败";
		onVerify(false);
	} finally {
		isSubmitting = false;
	}
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" && !isSubmitting) {
		handleSubmit();
	}
}
</script>

<div class="verify-wrapper">
	<div class="verify-card card-base">
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
			<!-- 用户名 -->
			<div class="field" class:focused={usernameFocused} class:filled={username.trim()}>
				<input
					id="verify-username"
					type="text"
					bind:value={username}
					onfocus={() => (usernameFocused = true)}
					onblur={() => (usernameFocused = false)}
					onkeydown={handleKeyDown}
					placeholder=" "
					autocomplete="username"
				/>
				<label for="verify-username">{i18n(I18nKey.verifyUsername)}</label>
			</div>

			<!-- 密码 -->
			<div class="field" class:focused={passwordFocused} class:filled={password.trim()}>
				<input
					id="verify-password"
					type={showPassword ? "text" : "password"}
					bind:value={password}
					onfocus={() => (passwordFocused = true)}
					onblur={() => (passwordFocused = false)}
					onkeydown={handleKeyDown}
					placeholder=" "
					autocomplete="current-password"
					class="password-input"
				/>
				<label for="verify-password">{i18n(I18nKey.verifyPassword)}</label>
				<button
					type="button"
					class="password-toggle"
					title={showPassword ? i18n(I18nKey.verifyPasswordHide) : i18n(I18nKey.verifyPasswordShow)}
					aria-label={showPassword ? i18n(I18nKey.verifyPasswordHide) : i18n(I18nKey.verifyPasswordShow)}
					onclick={() => (showPassword = !showPassword)}
				>
					<Icon
						icon={showPassword ? "material-symbols:visibility-off-outline-rounded" : "material-symbols:visibility-outline-rounded"}
						size="sm"
					/>
				</button>
			</div>

			<!-- 记住我 -->
			<label class="remember-row">
				<input type="checkbox" bind:checked={rememberMe} />
				<span>{i18n(I18nKey.verifyRememberMe)}</span>
			</label>

			{#if error}
				<div class="error-message">
					<Icon icon="material-symbols:error-outline" class="text-base" />
					<span>{error}</span>
				</div>
			{/if}

			<button
				class="submit-btn"
				class:loading={isSubmitting}
				onclick={handleSubmit}
				disabled={isSubmitting || !username.trim() || !password.trim()}
			>
				{#if isSubmitting}
					<span class="spinner"></span>
					{i18n(I18nKey.verifyLoggingIn)}
				{:else}
					{i18n(I18nKey.verifyLogin)}
				{/if}
			</button>
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

	.avatar-icon {
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

	/* 浏览器自动填充时，label 也需要上浮（bind:value 可能还没同步） */
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

	/* 覆盖浏览器自动填充的黄色背景 */
	.field input:-webkit-autofill {
		-webkit-text-fill-color: var(--deep-text);
		-webkit-box-shadow: 0 0 0 1000px var(--card-bg) inset;
		transition: background-color 9999s ease-in-out 0s;
	}

	/* ── 密码可见切换 ── */
	/* 右侧为"显示密码"按钮留出空间（含聚焦加粗边框时保持一致） */
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

	/* ── 记住我 ── */
	.remember-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--content-meta);
		cursor: pointer;
		user-select: none;
	}

	.remember-row input[type="checkbox"] {
		accent-color: var(--primary);
		width: 1rem;
		height: 1rem;
		margin: 0;
		cursor: pointer;
	}

	/* ── 错误提示 ── */
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
		background: var(--line-divider);
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
