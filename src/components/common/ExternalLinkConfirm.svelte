<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import Icon from "@/components/common/Icon.svelte";
	import I18nKey from "@/i18n/i18nKey";
	import { i18n } from "@/i18n/translation";

	// 通用外链安全确认弹窗
	// 挂载后自动拦截全局外链点击，弹窗确认后再跳转。
	// 所有文案支持动态传入，不传则使用当前站点的 i18n 翻译。
	// 注意：样式定义在 src/styles/main.css（.elc-*），因为组件以 client:only 挂载，
	// Svelte 的 <style> 无法通过 Astro 注入，必须用全局 CSS。
	interface Props {
		title?: string;
		subtitle?: string;
		addressLabel?: string;
		warningText?: string;
		cancelText?: string;
		confirmText?: string;
	}

	let {
		title = "",
		subtitle = "",
		addressLabel = "",
		warningText = "",
		cancelText = "",
		confirmText = "",
	}: Props = $props();

	let pendingUrl = $state<string | null>(null);

	// 是否属于站外 http(s) 链接（不同源）
	function isExternalUrl(href: string): boolean {
		try {
			const dest = new URL(href, window.location.href);
			return (
				(dest.protocol === "http:" || dest.protocol === "https:") &&
				dest.origin !== window.location.origin
			);
		} catch {
			return false;
		}
	}

	// 捕获阶段拦截，优先于页面内其他 handler（包括 swup 的导航接管）
	function handleDocumentClick(event: MouseEvent) {
		if (event.defaultPrevented) return;
		// 仅拦截左键普通点击；带修饰键的点击（新标签/另存为等）保持浏览器原生行为
		if (event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		const target = event.target as Element | null;
		const anchor = target?.closest?.("a[href]");
		if (!anchor) return;
		// 跳过「确认跳转」自己创建的临时锚点，避免再次触发拦截与弹窗
		if (anchor.hasAttribute("data-elc-skip")) return;

		const href = anchor.getAttribute("href") || "";
		if (!isExternalUrl(href)) return;

		event.preventDefault();
		pendingUrl = href;
	}

	// 打开确认后的目标地址：仅通过原生 <a target="_blank"> 触发一次打开
	// —— 单一通路，不涉及 window.open 的弹窗拦截策略，也绝不替换当前博客页
	function openConfirmedUrl(target: string) {
		const anchor = document.createElement("a");
		anchor.href = target;
		anchor.target = "_blank";
		anchor.rel = "noopener noreferrer";
		anchor.setAttribute("data-elc-skip", "1");
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	}

	function handleConfirm() {
		if (!pendingUrl) return;
		const target = pendingUrl;
		pendingUrl = null;
		openConfirmedUrl(target);
	}

	function handleCancel() {
		pendingUrl = null;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && pendingUrl) {
			handleCancel();
		}
	}

	onMount(() => {
		document.addEventListener("click", handleDocumentClick, true);
	});

	onDestroy(() => {
		document.removeEventListener("click", handleDocumentClick, true);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if pendingUrl}
	<div class="elc-overlay" onclick={handleCancel}>
		<div
			class="elc-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="elc-title"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- 头部：警告图标 + 标题/副标题 -->
			<div class="elc-header">
				<div class="elc-icon-circle">
					<Icon icon="material-symbols:warning" class="elc-icon" size="lg" />
				</div>
				<div class="elc-heading">
					<div class="elc-title" id="elc-title">{title || i18n(I18nKey.externalLinkTitle)}</div>
					<div class="elc-subtitle">
						{subtitle || i18n(I18nKey.externalLinkSubtitle)}
					</div>
				</div>
			</div>

			<!-- 目标地址信息区块 -->
			<div class="elc-url-box">
				<span class="elc-url-label">
					{addressLabel || i18n(I18nKey.externalLinkAddressLabel)}
				</span>
				<span class="elc-url">{pendingUrl}</span>
			</div>

			<!-- 风险警示提示条 -->
			<div class="elc-warning">
				<Icon icon="material-symbols:warning" class="elc-warning-icon" size="sm" />
				<span class="elc-warning-text">
					{warningText || i18n(I18nKey.externalLinkWarning)}
				</span>
			</div>

			<!-- 底部双按钮 -->
			<div class="elc-actions">
				<button type="button" class="elc-btn elc-cancel" onclick={handleCancel}>
					{cancelText || i18n(I18nKey.externalLinkCancel)}
				</button>
				<button type="button" class="elc-btn elc-confirm" onclick={handleConfirm}>
					{confirmText || i18n(I18nKey.externalLinkConfirm)}
				</button>
			</div>
		</div>
	</div>
{/if}