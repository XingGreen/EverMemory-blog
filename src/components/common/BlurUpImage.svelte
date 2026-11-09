<script lang="ts">
import { onMount } from "svelte";

/**
 * 模糊占位图（blur-up）。
 *
 * 加载阶段叠一张同源的高斯模糊图顶住视觉，容器尺寸由调用方给定并锁死，
 * 真实图片加载完成后只做透明度过渡，因此不会产生布局抖动。
 *
 * 前台静态页面用的是 ImageWrapper/CoverImage 里同一套做法（LQIP 占位 +
 * blur-up + 500ms 淡入）；这里是 Svelte 侧的实现，供后台这类客户端组件使用。
 * 两边的时长与模糊半径保持一致，站点前后台观感相同。
 */
let {
	src,
	alt = "",
	/** CSS 尺寸：容器固定宽高，避免图片到达后撑开布局 */
	width = "100%",
	height = "100%",
	radius = "0",
	fit = "cover",
	loading = "lazy",
	class: className = "",
}: {
	src: string;
	alt?: string;
	width?: string;
	height?: string;
	radius?: string;
	fit?: "cover" | "contain";
	loading?: "lazy" | "eager";
	class?: string;
} = $props();

let loaded = $state(false);
let failed = $state(false);
let imgEl: HTMLImageElement | null = $state(null);

/* 命中缓存时 load 事件可能早于监听器注册，挂载后补一次判断 */
onMount(() => {
	if (imgEl?.complete && imgEl.naturalWidth > 0) loaded = true;
});
</script>

<span
	class="blurup {className}"
	class:loaded
	class:failed
	style:width
	style:height
	style:border-radius={radius}
>
	{#if !failed}
		<img class="blurup-thumb" {src} alt="" aria-hidden="true" tabindex="-1" />
	{/if}
	<img
		bind:this={imgEl}
		class="blurup-img"
		{src}
		{alt}
		{loading}
		decoding="async"
		style:object-fit={fit}
		onload={() => (loaded = true)}
		onerror={() => (failed = true)}
	/>
</span>

<style>
	/* 容器尺寸由 width/height 内联给定并锁死，图片再怎么加载也不会撑开 */
	.blurup {
		position: relative;
		display: block;
		flex-shrink: 0;
		overflow: hidden;
		background: var(--btn-regular-bg);
	}

	.blurup-thumb {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* 高斯模糊会露出边缘，稍微放大盖住 */
		filter: blur(14px);
		transform: scale(1.08);
		opacity: 1;
		transition: opacity 0.4s ease-out;
	}

	.blurup-img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		transition: opacity 0.4s ease-out;
	}

	.blurup.loaded .blurup-thumb {
		opacity: 0;
	}

	.blurup.loaded .blurup-img {
		opacity: 1;
	}

	/* 加载失败时不再显示模糊层，只留中性底色 */
	.blurup.failed .blurup-thumb,
	.blurup.failed .blurup-img {
		display: none;
	}
</style>
