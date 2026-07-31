<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";

	let { onVerify }: { onVerify: (key: string, success: boolean) => void } = $props();

	let privateKey = $state("");
	let isSubmitting = $state(false);
	let error = $state("");
	let isDragging = $state(false);

	async function handleSubmit() {
		if (!privateKey.trim()) {
			error = "请输入或上传私钥";
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
				body: JSON.stringify({ privateKey: cleanKey }),
			});

			const data = await response.json();

			if (response.ok && data.success) {
				onVerify(cleanKey, true);
			} else {
				error = data.message || "验证失败";
				onVerify(cleanKey, false);
			}
		} catch {
			error = "网络请求失败";
			onVerify(cleanKey, false);
		} finally {
			isSubmitting = false;
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

	function handlePaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData("text");
		if (text) {
			privateKey = text;
			error = "";
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
			<p class="description">请输入或上传你的 GitHub App 私钥以访问管理后台</p>
		</div>

		<div class="verify-form">
			<div
				class={`upload-area ${isDragging ? "dragging" : ""}`}
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
				<input
					type="file"
					accept=".pem,.key,.txt"
					onchange={handleFileUpload}
					class="file-input"
					id="keyFile"
				/>
				<label for="keyFile" class="upload-label">
					<Icon icon="material-symbols:folder-open-rounded" class="upload-icon" />
					<span class="upload-text">点击上传或拖拽私钥文件</span>
					<span class="upload-hint">支持 .pem, .key, .txt 格式</span>
				</label>
			</div>

			<div class="key-input-wrapper">
				<textarea
					bind:value={privateKey}
					placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
					onpaste={handlePaste}
					class="key-textarea"
					rows={8}
				></textarea>
				{#if privateKey}
					<button
						class="clear-btn"
						onclick={() => {
							privateKey = "";
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
				disabled={isSubmitting || !privateKey.trim()}
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
					你的私钥仅存储在本地浏览器会话中（sessionStorage），
					不会上传到任何服务器。验证通过后即可管理博客文章。
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
		max-width: 520px;
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

	.upload-area {
		border: 2px dashed var(--line-divider);
		border-radius: var(--radius-md);
		padding: 1.25rem;
		text-align: center;
		transition: all 0.2s;
		cursor: pointer;
	}

	.upload-area.dragging {
		border-color: var(--primary);
		background: var(--btn-regular-bg);
	}

	.file-input {
		display: none;
	}

	.upload-label {
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}

	.upload-icon {
		font-size: 1.5rem;
		color: var(--content-meta);
	}

	.upload-text {
		font-weight: 500;
		color: var(--deep-text);
	}

	.upload-hint {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.key-input-wrapper {
		position: relative;
	}

	.key-textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		font-family: "Monaco", "Consolas", monospace;
		font-size: 0.75rem;
		line-height: 1.5;
		resize: vertical;
		transition: border-color 0.2s;
		background: var(--card-bg);
		color: var(--deep-text);
	}

	.key-textarea:focus {
		outline: none;
		border-color: var(--primary);
	}

	.clear-btn {
		position: absolute;
		top: 0.375rem;
		right: 0.375rem;
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
