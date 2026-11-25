<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import { portalToBody } from "@/utils/floating";

/**
 * 开屏幕布（共用版）。
 *
 * 代码原样取自 SetupPage.svelte 的 intro 序列，未改写：
 *   black（夜色静置、基线生长）→ logo（LOGO 显影）→ rise（题名收束、笔尖划到底）
 *   → fade（幕布上移）→ done
 *
 * OOBE 与管理页入口都用它，因此两者动画必然一致。
 */

let {
	phase,
	title,
	status,
	logoType = "icon",
	logoValue = "material-symbols:home-pin-outline",
	logoAlt = "",
	logoSrc = null,
	folio = "首次配置",
}: {
	phase: "black" | "logo" | "rise" | "fade" | "done";
	title: string;
	status: string;
	logoType?: "icon" | "image" | "url";
	logoValue?: string;
	logoAlt?: string;
	logoSrc?: string | null;
	folio?: string;
} = $props();

const introImageSrc = $derived(
	logoSrc ??
		(logoType === "url" || /^(https?:|\/)/.test(logoValue) ? logoValue : null),
);
</script>

<!-- 入场序列：夜色 → 显影 → 笔尖写到底 → 幕布上移；一次性装饰，不可交互 -->
{#if phase !== "done"}
	<div
		class="intro-black"
		class:intro-fade-out={phase === "fade"}
		use:portalToBody
		aria-hidden="true"
	>
		<!-- 图片在夜色阶段就进入 DOM 并开始加载，避免显影阶段才请求导致空场 -->
		<div class="intro-grid"></div>
		<span class="intro-folio">{folio}</span>
		<div class="intro-center">
			<div class="intro-logo">
				{#if introImageSrc}
					<img
						src={introImageSrc}
						alt={logoAlt}
						width="512"
						height="512"
						fetchpriority="high"
						decoding="sync"
					/>
				{:else}
					<Icon icon={logoValue} />
				{/if}
			</div>
			<div class="intro-wordmark">{title}</div>
			<p class="intro-status">{status}</p>
		</div>
		<div class="intro-baseline">
			<span class="intro-rule"></span>
			<span class="intro-nib"></span>
		</div>
	</div>
{/if}

<style>
	.intro-black {
		--intro-ink: #0e0b16;
		--intro-paper: #efeaf7;
		--intro-pollen: #e9c15b;
		--intro-rule: #2a2340;
		/* 字体栈定义在开屏自身：幕布 portal 到 body，不依赖后台 token 的作用域 */
		--intro-serif: "Iowan Old Style", "Palatino Linotype", "Source Han Serif SC",
			"Songti SC", Georgia, serif;
		--intro-mono: "JetBrains Mono", "Monaco", "Consolas", monospace;
		--ease-out: cubic-bezier(0.2, 0, 0, 1);

		position: fixed;
		inset: 0;
		z-index: 15000;
		background: var(--intro-ink);
		transition: transform 0.9s cubic-bezier(0.76, 0, 0.24, 1);
		will-change: transform;
	}

	.intro-black.intro-fade-out {
		transform: translateY(-101%);
		pointer-events: none;
	}

	/* 坐标格只在中心可见，边缘自然淡出 */
	.intro-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(to right, var(--intro-rule) 1px, transparent 1px),
			linear-gradient(to bottom, var(--intro-rule) 1px, transparent 1px);
		background-size: 34px 34px;
		opacity: 0.55;
		-webkit-mask-image: radial-gradient(
			ellipse 72% 62% at 50% 46%,
			#000 26%,
			transparent 78%
		);
		mask-image: radial-gradient(
			ellipse 72% 62% at 50% 46%,
			#000 26%,
			transparent 78%
		);
	}

	.intro-folio {
		position: absolute;
		top: clamp(20px, 4vh, 42px);
		left: clamp(24px, 7vw, 120px);
		font-family: var(--intro-mono);
		font-size: 11px;
		letter-spacing: 0.2em;
		color: color-mix(in oklab, var(--intro-paper) 58%, var(--intro-ink));
		animation: intro-rise-in 0.7s var(--ease-out) 0.1s both;
	}

	.intro-folio::after {
		content: "";
		display: block;
		width: 26px;
		height: 1px;
		margin-top: 9px;
		background: var(--intro-rule);
	}

	.intro-center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(16px, 2.8vh, 26px);
		padding-bottom: 6vh;
		text-align: center;
	}

	/* 三个主体元素的时间轴与样张一致，都从幕布出现起算，不受阶段切换影响 */
	.intro-logo {
		display: grid;
		place-items: center;
		animation: intro-develop 0.6s ease-out 0.72s both;
	}

	.intro-logo :global(.inline-icon) {
		font-size: clamp(96px, 22vw, 144px);
		color: var(--intro-paper);
	}

	.intro-logo img {
		/* 图片四周有透明留白，容器放大后花朵主体才与题名相称；
		   显式高宽让图片未解码时也占据稳定位置。 */
		width: clamp(128px, 20vw, 192px);
		height: auto;
		aspect-ratio: 1;
		object-fit: contain;
	}

	.intro-wordmark {
		font-family: var(--intro-serif);
		font-size: clamp(30px, 6.4vw, 54px);
		font-weight: 400;
		line-height: 1;
		letter-spacing: 0.26em;
		margin-right: -0.26em;
		color: var(--intro-paper);
		animation: intro-word-in 0.95s var(--ease-out) 1.5s both;
	}

	.intro-status {
		margin: 0;
		font-family: var(--intro-mono);
		font-size: 11px;
		letter-spacing: 0.18em;
		min-height: 1.4em;
		color: color-mix(in oklab, var(--intro-paper) 66%, var(--intro-ink));
		animation: intro-rise-in 0.6s ease-out 1.72s both;
	}

	/* 基线：书写线，左端与卷号同列 */
	.intro-baseline {
		position: absolute;
		left: clamp(24px, 7vw, 120px);
		right: clamp(24px, 7vw, 120px);
		bottom: clamp(64px, 18vh, 180px);
		height: 1px;
	}

	.intro-rule {
		position: absolute;
		inset: 0;
		background: var(--intro-rule);
		transform: scaleX(0);
		transform-origin: left center;
		animation: intro-rule-grow 0.9s var(--ease-out) 0.1s both;
	}

	.intro-nib {
		position: absolute;
		top: 50%;
		left: 0;
		width: 7px;
		height: 7px;
		background: var(--intro-pollen);
		transform: translate(-50%, -50%) rotate(45deg);
		opacity: 0;
		animation:
			intro-nib-in 0.3s ease-out 0.7s both,
			intro-nib-write 1.1s cubic-bezier(0.4, 0, 0.2, 1) 1.3s both;
	}

	@keyframes intro-rise-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes intro-develop {
		from {
			opacity: 0;
			filter: blur(4px);
		}
		to {
			opacity: 1;
			filter: blur(0);
		}
	}

	@keyframes intro-word-in {
		from {
			opacity: 0;
			letter-spacing: 0.26em;
			margin-right: -0.26em;
		}
		to {
			opacity: 1;
			letter-spacing: 0.035em;
			margin-right: -0.035em;
		}
	}

	@keyframes intro-rule-grow {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}

	@keyframes intro-nib-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes intro-nib-write {
		from {
			left: 0;
		}
		to {
			left: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro-black,
		.intro-folio,
		.intro-logo,
		.intro-wordmark,
		.intro-rule,
		.intro-nib {
			animation: none;
			transition: none;
		}

		.intro-logo {
			opacity: 1;
		}
		.intro-rule {
			transform: scaleX(1);
		}
		.intro-nib {
			opacity: 1;
			left: 100%;
		}
		.intro-wordmark {
			letter-spacing: 0.035em;
			margin-right: -0.035em;
		}
	}
</style>
