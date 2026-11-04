<script lang="ts">
/**
 * 草稿恢复确认。
 *
 * 不用 window.confirm：原生弹窗拿不到项目主题，也无法呈现「哪台设备、多久之前」
 * 这种需要排版的细节。结构和视觉参数对齐 DeleteConfirmModal。
 *
 * 两边的按钮文案写的是「后果」而不是「确定 / 取消」——
 * 这个动作会替换正文，用户需要知道每个选择之后会发生什么。
 */
let {
	open,
	ago,
	device,
	fromCloud,
	onRestore,
	onKeep,
}: {
	open: boolean;
	/** 相对时间，如「19 分钟前」 */
	ago: string;
	/** 设备描述，如「Chrome · Windows」 */
	device: string;
	/** 草稿来自云端（可能写在别的设备上） */
	fromCloud: boolean;
	onRestore: () => void;
	onKeep: () => void;
} = $props();

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") onKeep();
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onKeep();
		}}
	>
		<div
			class="modal-content"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="draft-restore-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 id="draft-restore-title">恢复未保存的修改？</h2>
			</div>

			<div class="modal-body">
				<p class="lead">
					<span class="when">{ago}</span>
					<span class="where">在 <code>{device}</code> 上</span>
					改过这篇文章，但没有保存。
				</p>
				{#if fromCloud}
					<p class="detail">
						这份草稿存在云端，可能是你在另一台设备上写的。
					</p>
				{:else}
					<p class="detail">这份草稿存在这台设备的浏览器里。</p>
				{/if}
				<ul class="outcomes">
					<li><b>恢复</b>：用草稿内容替换当前正文，之后可继续编辑</li>
					<li><b>保留</b>：当前正文不动，草稿继续留着，下次还能恢复</li>
				</ul>
			</div>

			<div class="modal-footer">
				<button class="ui-btn ui-btn-soft" type="button" onclick={onKeep}>
					保留当前正文
				</button>
				<button class="ui-btn ui-btn-primary" type="button" onclick={onRestore}>
					恢复草稿
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
		max-width: 460px;
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

	.when {
		font-weight: 600;
	}

	.where code {
		padding: 0.0625rem 0.3125rem;
		border-radius: 0.25rem;
		background: var(--btn-regular-bg);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
	}

	.detail {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.65;
		color: var(--content-meta);
	}

	.outcomes {
		margin: 0.875rem 0 0;
		padding: 0.75rem 0.875rem 0.75rem 1.875rem;
		border-radius: 0.5rem;
		background: var(--btn-regular-bg);
		font-size: 0.8125rem;
		line-height: 1.75;
		color: var(--content-meta);
	}

	.outcomes b {
		color: var(--deep-text);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 1.5rem 1.5rem;
	}
</style>
