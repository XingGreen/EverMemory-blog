<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";

	let { onVerify, avatarUrl = "" }: { onVerify: (success: boolean) => void; avatarUrl?: string } = $props();

	let username = $state("");
	let password = $state("");
	let privateKey = $state("");
	let isSubmitting = $state(false);
	let error = $state("");
	let isDragging = $state(false);

	// 浮动 label 状态
	let usernameFocused = $state(false);
	let passwordFocused = $state(false);
	let keyFocused = $state(false);

	async function handleSubmit() {
		const missing: string[] = [];
		if (!username.trim()) missing.push("用户名");
		if (!password.trim()) missing.push("密码");
		if (!privateKey.trim()) missing.push("私钥");

		if (missing.length > 0) {
			error = `请填写: ${missing.join("、")}`;
			return;
		}

		const cleanKey = privateKey
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.trim();

		isSubmitting = true;
		error = "";

		try {
			const response = await fetch("/api/admin/verify/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password, privateKey: cleanKey }),
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

	function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (evt) => {
				privateKey = evt.target?.result as string;
				error = "";
			};
			reader.readAsText(file);
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		const file = e.dataTransfer?.files[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (evt) => {
				privateKey = evt.target?.result as string;
				error = "";
			};
			reader.readAsText(file);
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

			<!-- 私钥 -->
			<div class="key-section">
				<div class="key-actions">
					<label for="keyFile" class="upload-btn">
						<Icon icon="material-symbols:upload" class="text-sm" />
						上传私钥文件
					</label>
					<input
						type="file"
						accept=".pem,.key,.txt"
						onchange={handleFileUpload}
						class="file-input"
						id="keyFile"
					/>
					<span class="key-hint">支持 .pem / .key 格式，或直接粘贴</span>
				</div>

				<div
					class={`key-field ${isDragging ? "dragging" : ""}`}
					class:focused={keyFocused}
					class:filled={privateKey.trim()}
					onDragenter={(e) => {
						e.preventDefault();
						isDragging = true;
					}}
					onDragleave={() => {
						isDragging = false;
					}}
					onDragover={(e) => {
						e.preventDefault();
					}}
					onDrop={handleDrop}
				>
					<textarea
						bind:value={privateKey}
						onfocus={() => (keyFocused = true)}
						onblur={() => (keyFocused = false)}
						placeholder=" "
						rows={5}
					></textarea>
					<label class={privateKey.trim() || keyFocused ? "float" : ""}>GitHub App 私钥</label>
					{#if privateKey}
						<button
							class="clear-btn"
							onclick={() => {
								privateKey = "";
								error = "";
							}}
							aria-label="清除私钥"
						>
							<Icon icon="material-symbols:close" class="text-sm" />
						</button>
					{/if}
				</div>
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
				disabled={isSubmitting || !username.trim() || !password.trim() || !privateKey.trim()}
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

	/* ── 私钥区域 ── */
	.key-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.key-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.upload-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--deep-text);
		cursor: pointer;
		transition: all 0.15s;
		background: var(--btn-regular-bg);
	}

	.upload-btn:hover {
		background: var(--btn-regular-bg-hover);
		border-color: var(--primary);
		color: var(--primary);
	}

	.file-input {
		display: none;
	}

	.key-hint {
		font-size: 0.6875rem;
		color: var(--content-meta);
	}

	.key-field {
		position: relative;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		transition: border-color 0.2s;
		background: var(--card-bg);
	}

	.key-field.dragging {
		border-color: var(--primary);
		background: var(--btn-regular-bg);
	}

	.key-field:focus-within {
		border-color: var(--primary);
		border-width: 2px;
	}

	.key-field textarea {
		width: 100%;
		padding: 1.25rem 2.25rem 0.5rem 0.625rem;
		border: none;
		border-radius: var(--radius-md);
		font-family: "Monaco", "Consolas", monospace;
		font-size: 0.6875rem;
		line-height: 1.5;
		resize: vertical;
		background: transparent;
		color: var(--deep-text);
	}

	.key-field textarea:focus {
		outline: none;
	}

	.key-field label {
		position: absolute;
		left: 0.625rem;
		top: 0.625rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		pointer-events: none;
		transition: all 0.18s ease;
	}

	.key-field label.float {
		top: 0;
		transform: translateY(-50%) scale(0.85);
		color: var(--primary);
		background: var(--card-bg);
		padding: 0 0.25rem;
		left: 0.5rem;
	}

	.clear-btn {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 20px;
		height: 20px;
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
