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
 * logo 必须由调用方传入：后台导航栏的 logo 可能是图标、图片或 URL，
 * 解析逻辑在 admin-logo.ts（读 siteConfig.navbar.logo），只有 astro 侧能拿到。
 * 不传就会退回组件默认的占位图标——那与 OOBE 显示的不是同一个东西。
 */
let {
	logoType,
	logoValue,
	logoAlt,
	logoSrc,
}: {
	logoType?: "icon" | "image" | "url";
	logoValue?: string;
	logoAlt?: string;
	logoSrc?: string | null;
} = $props();

/* 未显式传入时回退到站点导航栏 logo。
   admin-logo.ts 的解析要读文件系统（src 目录图片要 glob），只能在 astro 侧跑；
   这里退而取 siteConfig 的原始声明，至少不会像此前那样凭空用默认占位图标——
   那是与 OOBE 显示的完全不同的东西。 */
const navLogo = siteConfig.navbar.logo;
const resolvedType = $derived(logoType ?? navLogo?.type ?? "icon");
const resolvedValue = $derived(logoValue ?? navLogo?.value ?? "");
const resolvedAlt = $derived(logoAlt ?? navLogo?.alt ?? siteConfig.title);
/* image/url 类型且值是绝对路径或外链时可直接当 src 用；
   src 目录的相对图片没经过 astro 优化拿不到 URL，交给 Icon 之外的 img 会 404，
   因此只在值是 URL 形态时才传 src。 */
const resolvedSrc = $derived(
	logoSrc ??
		(resolvedType !== "icon" && /^(https?:|\/)/.test(resolvedValue)
			? resolvedValue
			: null),
);

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
	logoType={resolvedType}
	logoValue={resolvedValue}
	logoAlt={resolvedAlt}
	logoSrc={resolvedSrc}
	folio="EVERMEMORY / 控制台"
/>
