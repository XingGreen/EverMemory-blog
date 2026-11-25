<script lang="ts">
import { onMount } from "svelte";
import { siteConfig } from "@/config";
import { adminConfig } from "@/config/adminConfig";
import { portalToBody } from "@/utils/floating";

/**
 * 进入后台的开屏遮罩：盖住首屏，就绪后按配置退场。
 *
 * 关键约束：**效果与时长必须来自 adminConfig，不能另写一套数值。**
 * 历史上这里硬编码了 0.95s 上移 + 1200ms 拆除，而 pageTransition 配的是 220ms
 * slide-fade —— 同一个后台出现两种节奏，遮罩的退场看起来「没播完就被拆掉」。
 * 现在两者共用 pageTransition 的 effect / duration，只多一个 enable 开关。
 */
const veil = adminConfig.entryVeil ?? {};
const transition = adminConfig.pageTransition ?? {};

/** 是否播放：显式 false 才关；默认跟随 pageTransition.enable */
const enabled = veil.enable !== false && transition.enable !== false;

/** 效果：优先取 entryVeil.effect，否则跟随 pageTransition.effect */
const effect = veil.effect ?? transition.effect ?? "slide-fade";

/** 时长：优先取 entryVeil.duration，否则跟随 pageTransition.duration */
const duration = veil.duration ?? transition.duration ?? 220;

/**
 * 拆除定时 = 退场时长 + 余量。
 * 不能小于退场时长，否则遮罩在半途被 unmount，看起来「刚动就没了」。
 */
const REMOVE_AFTER = duration + 120;

let phase = $state<"cover" | "lift" | "done">("cover");

onMount(() => {
	if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		phase = "done";
		return;
	}
	// 两帧后再退场：给浏览器一次绘制机会，避免首屏闪出未遮盖的后台
	const raf = requestAnimationFrame(() => {
		requestAnimationFrame(() => (phase = "lift"));
	});
	const done = setTimeout(() => (phase = "done"), REMOVE_AFTER);

	// bfcache 恢复时 onMount 不会重跑：若恢复时还没到 done，遮罩会一直盖着
	const restore = (event: PageTransitionEvent) => {
		if (event.persisted) phase = "done";
	};
	window.addEventListener("pageshow", restore);
	return () => {
		cancelAnimationFrame(raf);
		clearTimeout(done);
		window.removeEventListener("pageshow", restore);
	};
});

/** 站名取站点配置，不再写死 */
const veilTitle = $derived(siteConfig.title ?? "");
</script>

{#if phase !== "done"}
	<div
		class="entry-veil"
		class:entry-lift={phase === "lift"}
		data-effect={effect}
		style={`--veil-duration:${duration}ms`}
		use:portalToBody
		aria-hidden="true"
	>
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
		/* 时长由配置下发，此处只声明用哪个自定义属性 */
		transition:
			transform var(--veil-duration) cubic-bezier(0.76, 0, 0.24, 1),
			opacity var(--veil-duration) ease-out;
		will-change: transform, opacity;
	}

	/* ── 四种效果，与 AdminDashboard 的 adminView* 同名同义 ──
	   slide-fade：上移淡出（默认）／fade：只淡出／slide：只上移／zoom：放大淡出。
	   这里不复制 @keyframes，而是用 transition 表达——遮罩只有一个元素、
	   只需一次退场，transition 比 animation 更直接，也少一份关键帧定义。 */
	.entry-veil[data-effect="slide-fade"].entry-lift {
		transform: translateY(-101%);
		opacity: 0;
		pointer-events: none;
	}

	.entry-veil[data-effect="fade"].entry-lift {
		opacity: 0;
		pointer-events: none;
	}

	.entry-veil[data-effect="slide"].entry-lift {
		transform: translateY(-101%);
		pointer-events: none;
	}

	.entry-veil[data-effect="zoom"].entry-lift {
		transform: scale(1.06);
		opacity: 0;
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
		/* 文字显现同样跟随配置时长，取三成 */
		animation: entry-develop calc(var(--veil-duration) * 0.3) ease-out both;
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
