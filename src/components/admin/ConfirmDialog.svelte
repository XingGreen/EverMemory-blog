<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "@/components/common/Icon.svelte";

/**
 * 通用确认弹窗。
 *
 * 替代 window.confirm：原生弹窗拿不到项目主题，也放不下「哪个选择更危险」
 * 这类必须说清的细节。结构与视觉参数对齐 DeleteConfirmModal。
 *
 * 按钮文案由调用方给，默认的「确定 / 取消」在很多场景下没有信息量——
 * 写「覆盖本地 / 取消」比「确定 / 取消」更能让人停下来想一秒。
 *
 * 也承载只读内容弹窗：传 children（自定义正文，如等宽代码块）且不传
 * 确认/取消回调时，footer 整体不渲染，右上角关闭按钮即为唯一出口。
 */
let {
	open,
	title,
	body,
	hint = "",
	confirmText = "确定",
	cancelText = "取消",
	/** 可选的第三个按钮：既不是确定也不是取消的第三条路，如「继续编辑」 */
	tertiaryText = "",
	tone = "default",
	/** 宽幅变体：内容弹窗（代码块等）用 640px，确认框保持 440px */
	wide = false,
	/** 可选的头部图标：内容型弹窗（如拦截提示）用它代替纯文字标题 */
	icon,
	children,
	onConfirm,
	onCancel,
	onTertiary,
}: {
	open: boolean;
	title: string;
	body: string;
	hint?: string;
	confirmText?: string;
	cancelText?: string;
	tertiaryText?: string;
	/** danger 时主按钮用破坏色，用于不可撤销、会丢数据的操作 */
	tone?: "default" | "danger";
	wide?: boolean;
	/** 可选的头部图标：内容型弹窗（如拦截提示）用它代替纯文字标题 */
	icon?: string;
	children?: Snippet;
	onConfirm?: () => void;
	onCancel?: () => void;
	onTertiary?: () => void;
} = $props();

/**
 * 点遮罩或按 Esc 的默认动作。
 * 有第三个按钮时走它——那种场景下「取消 / 不保存」通常不可逆，
 * 顺手点一下就丢数据太容易了。
 */
function handleDismiss() {
	if (onTertiary) onTertiary();
	else onCancel?.();
}

function handleKeydown(e: KeyboardEvent) {
	if (open && e.key === "Escape") handleDismiss();
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) handleDismiss();
		}}
	>
		<div
			class="modal-content"
			class:wide
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-dialog-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			{#if icon}
				<Icon {icon} class="modal-icon" aria-hidden="true" />
			{/if}
			<div class="modal-header">
				<h2 id="confirm-dialog-title">{title}</h2>
				{#if onTertiary}
					<button
						class="close-btn"
						type="button"
						onclick={onTertiary}
						aria-label="关闭"
					>
						<Icon icon="material-symbols:close" />
					</button>
				{/if}
			</div>

			{#if body || hint || children}
				<div class="modal-body">
					{#if body}
						<p class="lead">{body}</p>
					{/if}
					{#if hint}
						<p class="hint">{hint}</p>
					{/if}
					{@render children?.()}
				</div>
			{/if}

			{#if (confirmText && onConfirm) || (cancelText && onCancel) || (tertiaryText && onTertiary)}
				<div class="modal-footer">
					{#if tertiaryText && onTertiary}
						<button class="ui-btn ui-btn-ghost" type="button" onclick={onTertiary}>
							{tertiaryText}
						</button>
					{/if}
					{#if cancelText && onCancel}
						<button class="ui-btn ui-btn-soft" type="button" onclick={onCancel}>
							{cancelText}
						</button>
					{/if}
					{#if confirmText && onConfirm}
						<button
							class="ui-btn ui-btn-primary"
							class:danger={tone === "danger"}
							type="button"
							onclick={onConfirm}
						>
							{confirmText}
						</button>
					{/if}
				</div>
			{/if}
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
		/* 高于内容编辑弹窗（10000）：确认框是被它触发的，必须盖在它上面 */
		z-index: 12000;
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
		/* 视口高度封顶 + flex 纵排：header/footer 固定，body 独自滚动，
		   长内容（私钥等）不再把弹窗撑出屏幕 */
		max-height: min(85vh, 900px);
		display: flex;
		flex-direction: column;
		background: var(--float-panel-bg);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card-hover);
		overflow: hidden;
		animation: slideIn 0.3s ease-out;
	}

	/* 宽幅变体：代码块等结构化内容需要更宽的阅读列 */
	.modal-content.wide {
		max-width: 640px;
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

		/* Icon 组件根元素的 class 是运行时拼接的字符串，父级 scoped hash
	   不会落到它上面，只能用 :global 命中子组件传播出来的类名 */
	:global(.modal-icon) {
		display: block;
		margin: 1.25rem 1.5rem 0;
		font-size: 28px;
		color: var(--content-meta);
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 0.75rem;
		flex-shrink: 0;
	}

	.close-btn {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin: -0.25rem -0.25rem 0 0;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		flex-shrink: 0;
	}

	.close-btn:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.modal-body {
		/* 长内容在这里滚动（私钥 PEM 可达数屏高） */
		padding: 0 1.5rem 1rem;
		overflow-y: auto;
		min-height: 0;
		flex: 1;
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
		flex-shrink: 0;
	}
</style>
