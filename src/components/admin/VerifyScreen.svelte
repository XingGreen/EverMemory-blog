<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";

	let { onVerify, avatarUrl = "" }: { onVerify: (success: boolean) => void; avatarUrl?: string } = $props();

	let username = $state("");
	let password = $state("");
	let isSubmitting = $state(false);
	let error = $state("");

	// 浮动 label 状态
	let usernameFocused = $state(false);
	let passwordFocused = $state(false);

	async function handleSubmit() {
		const missing: string[] = [];
		if (!username.trim()) missing.push("用户名");
		if (!password.trim()) missing.push("密码");

		if (missing.length > 0) {
			error = `请填写: ${missing.join("、")}`;
			return;
		}

		isSubmitting = true;
		error = "";

		try {
			const response = await fetch("/api/admin/verify/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
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
		<div class="verify-header">
			<div class="avatar-wrapper">
				{#if avatarUrl}
					<img src={avatarUrl} alt="管理员头像" class="avatar-img" />
				{:else}
					<Icon icon="material-symbols:person-rounded" class="avatar-icon" />
				{/if}
			</div>
			<h1>管理员登录</h1>
			<p class="subtitle">欢迎回来，请输入你的登录凭证</p>
		</div>

		<div class="verify-form">
			<!-- 用户名 -->
			<div class="field" class:focused={usernameFocused} class:filled={username.trim()}>
				<input
					type="text"
					bind:value={username}
					onfocus={() => (usernameFocused = true)}
					onblur={() => (usernameFocused = false)}
					onkeydown={handleKeyDown}
					placeholder=" "
					autocomplete="username"
				/>
				<label>用户名</label>
			</div>

			<!-- 密码 -->
			<div class="field" class:focused={passwordFocused} class:filled={password.trim()}>
				<input
					type="password"
					bind:value={password}
					onfocus={() => (passwordFocused = true)}
					onblur={() => (passwordFocused = false)}
					onkeydown={handleKeyDown}
					placeholder=" "
					autocomplete="current-password"
				/>
				<label>密码</label>
			</div>

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
					登录中...
				{:else}
					登录
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
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 400px;
	}

	.verify-header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.avatar-wrapper {
		width: 4rem;
		height: 4rem;
		margin: 0 auto 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--primary);
		color: white;
		border-radius: 50%;
		overflow: hidden;
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
		border: 1px solid var(--line-divider);
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
		padding: 0.75rem;
		border: none;
		border-radius: var(--radius-md);
		background: var(--primary);
		color: white;
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
	}

	.submit-btn:hover:not(:disabled) {
		opacity: 0.9;
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
