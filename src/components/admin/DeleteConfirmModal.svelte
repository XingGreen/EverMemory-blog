<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";

	let { title, onConfirm, onCancel }: {
		title: string;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let confirmText = $state("");
	let isSubmitting = $state(false);
	let shakeError = $state(false);

	function handleConfirm() {
		if (confirmText !== title) {
			shakeError = true;
			setTimeout(() => {
				shakeError = false;
			}, 500);
			return;
		}

		isSubmitting = true;
		onConfirm();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="modal-overlay"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) {
			onCancel();
		}
	}}
>
	<div
		class="modal-content"
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="confirm-title"
		aria-describedby="confirm-description"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="modal-header">
			<Icon icon="material-symbols:warning-rounded" class="modal-icon" />
			<h2 id="confirm-title">确认删除</h2>
		</div>

		<div class="modal-body">
			<p id="confirm-description" class="warning-text">
				你即将删除文章 <strong>"{title}"</strong>。此操作不可撤销。
			</p>

			<div class="confirm-instructions">
				<p>请在下方输入文章标题以确认删除：</p>
				<code>{title}</code>
			</div>

			<input
				type="text"
				bind:value={confirmText}
				placeholder="输入文章标题确认删除"
				class={`confirm-input ${shakeError ? "shake" : ""} ${confirmText === title ? "matched" : ""}`}
			/>

			{#if confirmText && confirmText !== title}
				<p class="hint-text">标题不匹配，请仔细核对</p>
			{:else if confirmText === title}
				<p class="success-text">
					<Icon icon="material-symbols:check" class="text-sm" />
					标题已确认，可以删除
				</p>
			{/if}
		</div>

		<div class="modal-footer">
			<button class="btn btn-cancel" onclick={onCancel} disabled={isSubmitting}>
				取消
			</button>
			<button
				class={`btn btn-delete ${confirmText === title ? "enabled" : ""}`}
				onclick={handleConfirm}
				disabled={isSubmitting || confirmText !== title}
			>
				{#if isSubmitting}
					<span class="spinner"></span>
					删除中...
				{:else}
					<Icon icon="material-symbols:close" class="text-sm" />
					确认删除
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		animation: fadeIn 0.2s ease-out;
		cursor: pointer;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-content {
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		width: 90%;
		max-width: 480px;
		box-shadow: var(--shadow-card-hover);
		overflow: hidden;
		animation: slideIn 0.3s ease-out;
		position: relative;
		z-index: 1;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.5rem;
		border-bottom: 1px solid var(--line-divider);
		background: color-mix(in srgb, #ef4444 10%, transparent);
	}

	.modal-icon {
		font-size: 1.5rem;
		color: #ef4444;
	}

	.modal-header h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: #ef4444;
	}

	.modal-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		color: var(--deep-text);
	}

	.warning-text {
		line-height: 1.6;
	}

	.warning-text strong {
		color: #ef4444;
		word-break: break-all;
	}

	.confirm-instructions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--btn-regular-bg);
		border-radius: var(--radius-md);
	}

	.confirm-instructions p {
		font-size: 0.875rem;
		color: var(--content-meta);
	}

	.confirm-instructions code {
		padding: 0.5rem 0.75rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		color: #ef4444;
		font-family: "Monaco", "Consolas", monospace;
		word-break: break-all;
	}

	.confirm-input {
		padding: 0.625rem 0.875rem;
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		transition: all 0.15s;
		background: var(--card-bg);
		color: var(--deep-text);
	}

	.confirm-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.confirm-input.matched {
		border-color: #22c55e;
		background: color-mix(in srgb, #22c55e 10%, transparent);
	}

	.confirm-input.shake {
		animation: shake 0.5s;
		border-color: #ef4444;
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		10%,
		30%,
		50%,
		70%,
		90% {
			transform: translateX(-5px);
		}
		20%,
		40%,
		60%,
		80% {
			transform: translateX(5px);
		}
	}

	.hint-text {
		color: #f59e0b;
		font-size: 0.8rem;
	}

	.success-text {
		color: #22c55e;
		font-size: 0.8rem;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--line-divider);
		background: var(--btn-plain-bg-hover);
	}

	.btn {
		padding: 0.625rem 1.25rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.btn-cancel {
		background: var(--card-bg);
		color: var(--deep-text);
		border: 1px solid var(--line-divider);
	}

	.btn-cancel:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
	}

	.btn-delete {
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: not-allowed;
	}

	.btn-delete.enabled {
		background: var(--destructive);
		color: var(--destructive-foreground);
		cursor: pointer;
		border-radius: var(--radius-large);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--destructive) 40%, transparent);
	}

	.btn-delete.enabled:hover:not(:disabled) {
		filter: brightness(1.05);
		transform: translateY(-1px);
	}

	.btn-delete:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>