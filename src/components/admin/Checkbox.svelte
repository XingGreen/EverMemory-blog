<script lang="ts">
/**
 * 复选框。
 *
 * 原生 input 在各平台外观差异大（Windows 是方角灰框，macOS 是圆角蓝勾），
 * 也和后台的主题色对不上。这里保留 input 语义与键盘可达性，
 * 只把绘制交给项目自己的样式。
 */
let {
	checked = false,
	disabled = false,
	label = "",
	onchange,
}: {
	checked?: boolean;
	disabled?: boolean;
	/** 无可见文字时作为无障碍名称 */
	label?: string;
	onchange?: () => void;
} = $props();
</script>

<label class="cb" class:disabled>
	<input
		type="checkbox"
		{checked}
		{disabled}
		aria-label={label || undefined}
		onchange={() => onchange?.()}
	/>
	<span class="box" aria-hidden="true"></span>
</label>

<style>
	.cb {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		cursor: pointer;
	}

	.cb.disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	/* 视觉交给 .box，原生控件只保留语义与点击区 */
	.cb input {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.box {
		display: block;
		width: 0.875rem;
		height: 0.875rem;
		border: 1.5px solid var(--line-divider);
		border-radius: 0.25rem;
		background: transparent;
		transition:
			background 0.15s,
			border-color 0.15s;
		position: relative;
	}

	.cb:hover:not(.disabled) .box {
		border-color: var(--primary);
	}

	.cb input:checked + .box {
		background: var(--primary);
		border-color: var(--primary);
	}

	/* 勾：用两条边框拼，避免额外图标资源 */
	.cb input:checked + .box::after {
		content: "";
		position: absolute;
		left: 0.1875rem;
		top: 0.0625rem;
		width: 0.25rem;
		height: 0.4375rem;
		border: solid var(--primary-foreground, #fff);
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	.cb input:focus-visible + .box {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
</style>
