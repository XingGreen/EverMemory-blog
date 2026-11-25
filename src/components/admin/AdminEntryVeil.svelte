<script lang="ts">
import { onMount } from "svelte";
import { siteConfig } from "@/config";
import IntroSplash from "@/components/common/IntroSplash.svelte";

/**
 * 进入后台的开屏幕布。
 *
 * 视觉与动画**全部来自 IntroSplash**（与 OOBE 共用的那一份），本文件只负责
 * 驱动阶段：black → logo → rise → fade → done，时序照抄 SetupPage 里的取值
 * （200ms 进入 logo，1100ms 进入 rise，再等 1400ms 收幕，900ms 过渡）。
 *
 * 此前这里自带一套 entry-* 样式与 keyframes，与 OOBE 完全是两种动效，
 * 现在两者跑同一份代码，动画必然一致。
 */
let phase = $state<"black" | "logo" | "rise" | "fade" | "done">("black");

onMount(() => {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		phase = "done";
		return;
	}
	const timers = [
		setTimeout(() => (phase = "logo"), 200),
		setTimeout(() => (phase = "rise"), 1100),
		setTimeout(() => (phase = "fade"), 1100 + 1400),
		setTimeout(() => (phase = "done"), 1100 + 1400 + 900 + 80),
	];
	return () => {
		for (const t of timers) clearTimeout(t);
	};
});

/** 站名与状态取真实值，不写死 */
const veilTitle = $derived(siteConfig.title ?? "");
const veilStatus = $derived(
	phase === "fade" || phase === "done" ? "已就绪" : "正在载入控制台",
);
</script>

<IntroSplash
	{phase}
	title={veilTitle}
	status={veilStatus}
	folio="EVERMEMORY / 控制台"
/>
