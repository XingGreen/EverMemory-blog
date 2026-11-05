<script lang="ts">
import "@material/web/button/filled-button.js";
import "@material/web/button/text-button.js";
import "@material/web/dialog/dialog.js";

/**
 * 草稿恢复确认。
 *
 * 用 MD3 的 md-dialog 替代自建 overlay：
 *   - 打开/关闭是命令式 API（show() / close()），不是属性绑定，所以要用 $effect 同步
 *   - 遮罩点击与 Esc 由组件自己处理，关闭后抛 closed 事件，据此回传「保留当前正文」
 *
 * 主题通过 --md-sys-color-* 映射到项目变量，避免出现第二套配色。
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
	ago: string;
	device: string;
	fromCloud: boolean;
	onRestore: () => void;
	onKeep: () => void;
} = $props();

/** md-dialog 的实例：bind:this 的目标必须是 $state 才是响应式的 */
let dialogEl = $state<(HTMLElement & { show(): void; close(): void }) | null>(
	null,
);
/** 上一次同步过去的开关状态，避免重复调用 show/close */
let shown = false;
/**
 * 本次关闭是否由代码发起。
 * md-dialog 的 close() 同样会抛 closed 事件，而那时「用户选了什么」已经由
 * onRestore / onKeep 传回去了；不区分的话，close() 的 closed 会把结果覆写成「保留」。
 */
let closingByProgram = false;

$effect(() => {
	const el = dialogEl;
	// 自定义元素尚未升级时没有 show/close，等它就绪
	if (!el || typeof el.show !== "function") return;
	if (open && !shown) {
		el.show();
		shown = true;
	} else if (!open && shown) {
		shown = false;
		closingByProgram = true;
		el.close();
	}
});

$effect(() => {
	const el = dialogEl;
	if (!el) return;
	const handleClosed = () => {
		shown = false;
		// 代码关的：结果已经回传过，这里只负责清标记
		if (closingByProgram) {
			closingByProgram = false;
			return;
		}
		// 用户关的（遮罩 / Esc）：等同于「保留当前正文」
		onKeep();
	};
	el.addEventListener("closed", handleClosed);
	return () => el.removeEventListener("closed", handleClosed);
});
</script>

<md-dialog bind:this={dialogEl} class="draft-dialog">
	<div slot="headline">恢复未保存的修改？</div>

	<div slot="content">
		<p class="lead">
			<span class="when">{ago}</span>
			在 <code>{device}</code> 上改过这篇文章，但没有保存。
		</p>
		{#if fromCloud}
			<p class="detail">这份草稿存在云端，可能是你在另一台设备上写的。</p>
		{:else}
			<p class="detail">这份草稿存在这台设备的浏览器里。</p>
		{/if}
		<ul class="outcomes">
			<li><b>恢复</b>：用草稿内容替换当前正文，之后可继续编辑</li>
			<li><b>保留</b>：当前正文不动，草稿继续留着，下次还能恢复</li>
		</ul>
	</div>

	<div slot="actions">
		<md-text-button onclick={onKeep}>保留当前正文</md-text-button>
		<md-filled-button onclick={onRestore}>恢复草稿</md-filled-button>
	</div>
</md-dialog>

<style>
	/* MD3 配色变量映射到项目变量：不映射就会冒出 Material 默认的紫色 */
	.draft-dialog {
		--md-sys-color-surface: var(--float-panel-bg);
		--md-sys-color-surface-container-high: var(--float-panel-bg);
		--md-sys-color-on-surface: var(--deep-text);
		--md-sys-color-on-surface-variant: var(--content-meta);
		--md-sys-color-primary: var(--primary);
		--md-sys-color-on-primary: #fff;
		--md-sys-color-secondary-container: var(--btn-regular-bg);
		--md-sys-color-on-secondary-container: var(--deep-text);
		--md-sys-shape-corner-extra-large: var(--radius-large);
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

	.lead code {
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
</style>
