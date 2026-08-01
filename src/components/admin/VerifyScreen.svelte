<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";

	let { onVerify }: { onVerify: (success: boolean) => void } = $props();

	let password = $state("");
	let isSubmitting = $state(false);
	let error = $state("");

	async function handleSubmit() {
		if (!password.trim()) {
			error = "请输入管理密码";
			return;
		}

		isSubmitting = true;
		error = "";

		try {
			const response = await fetch("/api/admin/verify/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
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
			<div class="lock-icon-wrapper">
				<Icon icon="material-symbols:lock-outline" class="lock-icon" />
			</div>
			<h1>管理后台验证</h1>
			<p class="description">请输入管理密码以访问管理后台</p>
		</div>

		<div class="verify-form">
			<div class="password-input-wrapper">
				<input
					type="password"
					bind:value={password}
					onkeydown={handleKeyDown}
					placeholder="管理密码"
					class="password-input"
				autocomplete="current-password"
				/>
				{#if password}
					<button
						class="clear-btn"
						onclick={() => {
							password = "";
							error = "";
						}}
						aria-label="清除"
					>
						<Icon icon="material-symbols:close" class="text-sm" />
					</button>
				{/if}
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
				disabled={isSubmitting || !password.trim()}
			>
				{#if isSubmitting}
					<span class="spinner"></span>
					验证中...
				{:else}
					验证并进入后台
				{/if}
			</button>

			<div class="security-notice">
				<Icon icon="material-symbols:shield-lock" class="text-lg" />
				<p>
					管理密码仅在验证时传输，通过后使用 HttpOnly Cookie 维持会话。
					GitHub App 私钥仅存在于服务端，不会经过浏览器。
				</p>
			</div>
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
		padding: 2rem;
		width: 100%;
		max-width: 420px;
	}

	.verify-header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.lock-icon-wrapper {
		width: 4rem;
		height: 4rem;
		margin: 0 auto 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--primary);
		color: white;
		border-radius: var(--radius-lg);
	}

	.lock-icon {
		font-size: 1.75rem;
	}

	.verify-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.375rem;
	}

	.description {
		color: var(--content-meta);
		font-size: 0.875rem;
	}

	.verify-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.password-input-wrapper {
		position: relative;
	}

	.password-input {
		width: 100%;
		padding: 0.75rem 2.5rem 0.75rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		transition: border-color 0.2s;
		background: var(--card-bg);
		color: var(--deep-text);
		font-family: inherit;
	}

	.password-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.clear-btn {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--radius-sm);
		background: var(--line-divider);
		color: var(--deep-text);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.clear-btn:hover {
		background: var(--btn-regular-bg-hover);
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: var(--radius-sm);
		color: #ef4444;
		font-size: 0.875rem;
	}

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

	.security-notice {
		display: flex;
		gap: 0.625rem;
		padding: 0.625rem 0.75rem;
		background: var(--btn-regular-bg);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--content-meta);
		line-height: 1.5;
	}
</style>
