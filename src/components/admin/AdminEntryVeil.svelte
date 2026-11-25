<script lang="ts">
import { onMount } from "svelte";
import { siteConfig } from "@/config";
import { adminConfig } from "@/config/adminConfig";
import { portalToBody } from "@/utils/floating";

/**
 * 进入后台的开屏幕布。
 *
 * **不再有独立实现**：结构、动画、样式全部来自 `src/styles/splash.css`，
 * 与 OOBE（/setup/）是同一份代码。这里只负责阶段状态与配置取值。
 *
 * 历史：这里曾自带一套 entry-* 样式，硬编码 0.95s 上移 + 1200ms 拆除，
 * 完全不读配置；而 OOBE 那套被单独删除后，两处体验彻底分叉。
 */
const veil = adminConfig.entryVeil ?? {};

/** 是否播放：只由 entryVeil.enable 决定 */
const enabled = veil.enable !== false;

/** 效果 */
const effect = veil.effect ?? "slide-fade";

/**
 * 时长：只取 entryVeil.duration。
 * 不能回退到 pageTransition.duration——后者服务「内容位移 10px」，
 * 套到「整屏约 1010px 位移」上会让遮罩单帧跳过数百像素，肉眼只看到闪。
 */
const duration = veil.duration ?? 900;

/** 拆除定时 = 退场时长 + 余量，不能小于退场时长，否则半途被 unmount */
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

/** 站名取站点配置 */
const veilTitle = $derived(siteConfig.title ?? "");
</script>

{#if phase !== "done"}
	<div
		class="splash-veil"
		class:is-leaving={phase === "lift"}
		data-effect={effect}
		style={`--splash-duration:${duration}ms`}
		use:portalToBody
		aria-hidden="true"
	>
		<div class="splash-grid"></div>
		<div class="splash-center">
			<span class="splash-wordmark">{veilTitle}</span>
		</div>
	</div>
{/if}
