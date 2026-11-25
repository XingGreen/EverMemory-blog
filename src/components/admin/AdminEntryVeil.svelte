<script lang="ts">
import { onMount } from "svelte";
import { siteConfig } from "@/config";
import { portalToBody } from "@/utils/floating";

/**
 * 进入后台的一次性幕布：夜色盖住首屏，就绪后上移退场露出控制台。
 * 只在整页加载时播放一次；后台内部切页走 AdminDashboard 自己的动画。
 * 幕布 portal 到 body，避开 .admin-content 的 zoom 影响 fixed 定位。
 *
 * ── 为什么要「最短停留」──
 * 原先 onMount 里两个 rAF 之后就立刻退场，等于「页面一挂载就开始收」。
 * 本机 dev 环境加载极快，幕布在用户看清站名之前就开始上移，观感是
 * 「动画无效」；只有加载慢、首帧被拖长时才勉强看得到。
 * 这里给一个最短展示时长，让动画时长不再取决于网络/编译速度。
 */
const HOLD_MS = 900;
/** 退场过渡时长，必须与下方 .entry-veil 的 transition 一致 */
const LIFT_MS = 950;

let phase = $state<"cover" | "lift" | "done">("cover");

/** 站名取站点配置，不再写死 */
const veilTitle = $derived(siteConfig.title ?? "");

onMount(() => {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		phase = "done";
		return;
	}
	/* 先让幕布完整显示 HOLD_MS，再开始上移。
	   两个 rAF 只用于「确保首帧已绘制」，不承担停留职责。 */
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	const raf = requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			holdTimer = setTimeout(() => (phase = "lift"), HOLD_MS);
		});
	});
	const done = setTimeout(() => (phase = "done"), HOLD_MS + LIFT_MS + 120);
	// bfcache 恢复时 onMount 不会重跑：若恢复时还没到 done，遮罩会一直盖着
	// 只在 persisted 时复位，初次加载的 pageshow 不能跳过入场
	const restore = (event: PageTransitionEvent) => {
		if (event.persisted) phase = "done";
	};
	window.addEventListener("pageshow", restore);
	return () => {
		cancelAnimationFrame(raf);
		clearTimeout(holdTimer);
		clearTimeout(done);
		window.removeEventListener("pageshow", restore);
	};
});
</script>

{#if phase !== "done"}
	<div class="entry-veil" class:entry-lift={phase === "lift"} use:portalToBody aria-hidden="true">
		<div class="entry-grid"></div>
		<div class="entry-center">
			<span class="entry-name">{veilTitle}</span>
		</div>
	</div>
{/if}

<style>
	.entry-veil {
		position: fixed;
		inset: 0;
		z-index: 14999;
		background: #0e0b16;
		transition: transform 0.95s cubic-bezier(0.76, 0, 0.24, 1);
		will-change: transform;
	}

	.entry-veil.entry-lift {
		transform: translateY(-101%);
		pointer-events: none;
	}

	.entry-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(to right, #2a2340 1px, transparent 1px),
			linear-gradient(to bottom, #2a2340 1px, transparent 1px);
		background-size: 34px 34px;
		opacity: 0.55;
		-webkit-mask-image: radial-gradient(ellipse 72% 62% at 50% 46%, #000 26%, transparent 78%);
		mask-image: radial-gradient(ellipse 72% 62% at 50% 46%, #000 26%, transparent 78%);
	}

	.entry-center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 20px;
		padding-bottom: 6vh;
		text-align: center;
	}

	.entry-name {
		font-family: "Iowan Old Style", "Palatino Linotype", "Source Han Serif SC",
			"Songti SC", Georgia, serif;
		font-size: clamp(30px, 6.4vw, 54px);
		font-weight: 400;
		line-height: 1;
		letter-spacing: 0.035em;
		color: #efeaf7;
		animation: entry-develop 0.6s ease-out 0.18s both;
	}

	@keyframes entry-develop {
		from {
			opacity: 0;
			filter: blur(4px);
		}
		to {
			opacity: 1;
			filter: blur(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.entry-veil {
			transition: none;
		}
		.entry-name {
			animation: none;
		}
	}
</style>
