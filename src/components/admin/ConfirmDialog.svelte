<script lang="ts">
/**
 * 通用确认弹窗。
 *
 * 替代 window.confirm：原生弹窗拿不到项目主题，也放不下「哪个选择更危险」
 * 这类必须说清的细节。结构与视觉参数对齐 DeleteConfirmModal。
 *
 * 按钮文案由调用方给，默认的「确定 / 取消」在很多场景下没有信息量——
 * 写「覆盖本地 / 取消」比「确定 / 取消」更能让人停下来想一秒。
 */
let {
	open,
	title,
	body,
	hint = "",
	confirmText = "确定",
	cancelText = "取消",
	tone = "default",
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	body: string;
	hint?: string;
	confirmText?: string;
	cancelText?: string;
	/** danger 时主按钮用破坏色，用于不可撤销、会丢数据的操作 */
	tone?: "default" | "danger";
	onConfirm: () => void;
	onCancel: () => void;
} = $props();

function handleKeydown(e: KeyboardEvent) {
	if (open && e.key === "Escape") onCancel();
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onCancel();
		}}
	>
		<div
			class="modal-content"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-dialog-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 id="confirm-dialog-title">{title}</h2>
			</div>

			<div class="modal-body">
				<p class="lead">{body}</p>
				{#if hint}
					<p class="hint">{hint}</p>
				{/if}
			</div>

			<div class="modal-footer">
				<button class="ui-btn ui-btn-soft" type="button" onclick={onCancel}>
					{cancelText}
				</button>
				<button
					class="ui-btn ui-btn-primary"
					class:danger={tone === "danger"}
					type="button"
					onclick={onConfirm}
				>
					{confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.25);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
		animation: fadeIn 0.2s ease-out;
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
		width: 90%;
		max-width: 440px;
		background: var(--float-panel-bg);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card-hover);
		overflow: hidden;
		animation: slideIn 0.3s ease-out;
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
		padding: 1.25rem 1.5rem 0.75rem;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.modal-body {
		padding: 0 1.5rem 1rem;
	}

	.lead {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--deep-text);
	}

	.hint {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.65;
		color: var(--content-meta);
	}

	/* 项目没有 ui-btn-danger：破坏性操作在这里覆盖主按钮配色 */
	.ui-btn.danger {
		background: var(--destructive, #d33);
		color: #fff;
	}

	.ui-btn.danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--destructive, #d33) 85%, #000);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 1.5rem 1.5rem;
	}
</style>
