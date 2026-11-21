<script lang="ts">
import { onMount } from "svelte";
import { portalToBody } from "@/utils/floating";

/**
 * 进入后台的一次性幕布：夜色盖住首屏，就绪后上移退场露出控制台。
 * 只在整页加载时播放一次；后台内部切页走 AdminDashboard 自己的动画。
 * 幕布 portal 到 body，避开 .admin-content 的 zoom 影响 fixed 定位。
 */
let phase = $state<"cover" | "lift" | "done">("cover");

onMount(() => {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		phase = "done";
		return;
	}
	// 两帧后开始退场：给浏览器一次绘制机会，避免首屏闪出未遮盖的后台
	const raf = requestAnimationFrame(() => {
		requestAnimationFrame(() => (phase = "lift"));
	});
	const done = setTimeout(() => (phase = "done"), 1200);
	// bfcache 恢复时 onMount 不会重跑：若恢复时还没到 done，遮罩会一直盖着
	// 只在 persisted 时复位，初次加载的 pageshow 不能跳过入场
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
</script>

{#if phase !== "done"}
	<div class="entry-veil" class:entry-lift={phase === "lift"} use:portalToBody aria-hidden="true">
		<div class="entry-grid"></div>
		<div class="entry-center">
			<span class="entry-name">EverMemory</span>
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
