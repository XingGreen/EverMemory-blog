<script lang="ts">
	/**
	 * 后台统一的加载骨架：内容加载期间占住真实排版高度，加载完成不跳动。
	 * 规范见 docs/ADMIN_UI.md——页面结构加载用骨架屏，拒绝转圈与文字提示。
	 */
	import {
		variant = "lines",
		rows = 4,
	}: {
		/** lines: 几行文字位；form: 表单位（标题+短行+输入行）；list: 列表行位；panel: 整块区域 */
		variant?: "lines" | "form" | "list" | "panel";
		rows?: number;
	} = $props();
</script>

<div class="skeleton" aria-hidden="true">
	{#if variant === "form"}
		<div class="sk sk-title"></div>
		<div class="sk sk-line"></div>
		<div class="sk sk-line"></div>
		<div class="sk sk-area"></div>
	{:else if variant === "list"}
		{#each Array(rows) as _, i (i)}
			<div class="sk sk-row"></div>
		{/each}
	{:else if variant === "panel"}
		<div class="sk sk-area tall"></div>
	{:else}
		{#each Array(rows) as _, i (i)}
			<div class="sk sk-line"></div>
		{/each}
	{/if}
</div>

<style>
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		width: 100%;
	}

	.sk {
		border-radius: 8px;
		background: linear-gradient(
			100deg,
			var(--input-bg) 40%,
			color-mix(in oklab, var(--deep-text) 8%, var(--input-bg)) 50%,
			var(--input-bg) 60%
		);
		background-size: 200% 100%;
		animation: sk-sweep 1.4s ease-in-out infinite;
	}

	.sk-title {
		height: 1.25rem;
		width: 30%;
	}

	.sk-line {
		height: 2.5rem;
		width: 100%;
	}

	.sk-area {
		height: 8rem;
		width: 100%;
	}

	.sk-area.tall {
		height: 100%;
		min-height: 12rem;
		flex: 1;
	}

	.sk-row {
		height: 2.75rem;
		width: 100%;
	}

	@keyframes sk-sweep {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}
</style>
