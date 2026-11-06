<script lang="ts">
import type { Snippet } from "svelte";
import {
	type FloatingPosition,
	floatingStyle,
	placeUnder,
	portalToBody,
} from "@/utils/floating";

/**
 * 下拉菜单外壳。
 *
 * 只负责开合、定位、点击外部与 Esc 关闭，视觉在 ui-base 的 .ui-menu。
 *
 * 为什么 fixed 并挂到 body：后台的 .admin-page 有 overflow: hidden、
 * .md3-list 有 overflow: auto，absolute 菜单会被裁掉；而 .admin-content 带 zoom，
 * 祖先里的 rect 是放大后的视觉坐标，fixed 偏移又乘一次 zoom 会线性漂移。
 * 定位算法与 PostRowMenu 一致，公共部分抽在 utils/floating。
 */
let {
	open = $bindable(false),
	align = "end",
	title = "",
	trigger,
	content,
}: {
	open?: boolean;
	align?: "start" | "end";
	/** 菜单顶部的标题，说明这个菜单是做什么的 */
	title?: string;
	trigger: Snippet;
	content: Snippet;
} = $props();

let rootEl = $state<HTMLElement | null>(null);
let menuEl = $state<HTMLElement | null>(null);
let pos = $state<FloatingPosition | null>(null);

/** 调用方改 open 时补一次定位；不是所有入口都走内部 toggle */
$effect(() => {
	if (open && !pos && rootEl) pos = placeUnder(rootEl, align);
	if (!open && pos) pos = null;
});

/** 菜单节点挂到 body，脱离所有 overflow 祖先 */
$effect(() => {
	const el = menuEl;
	if (!el) return;
	portalToBody(el);
	return () => {
		el.remove();
	};
});

$effect(() => {
	if (!open) return;

	const onPointerDown = (e: MouseEvent) => {
		const target = e.target as Node;
		/* 触发器与菜单不在同一子树，两边都要判 */
		if (rootEl?.contains(target) || menuEl?.contains(target)) return;
		open = false;
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") open = false;
	};
	/* 页面滚动或改尺寸时收起：菜单 fixed，不跟随内容移动。
	   但菜单自己内部的滚动不算——否则一滚就关，看起来像「滚不动」。 */
	const onScroll = (e: Event) => {
		if (menuEl?.contains(e.target as Node)) return;
		open = false;
	};
	const onResize = () => {
		open = false;
	};

	document.addEventListener("mousedown", onPointerDown);
	document.addEventListener("keydown", onKeyDown);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", onResize);
	return () => {
		document.removeEventListener("mousedown", onPointerDown);
		document.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", onResize);
	};
});
</script>

<div class="dropdown" bind:this={rootEl}>
	{@render trigger()}
</div>

{#if open && pos}
	<div
		class="ui-menu"
		bind:this={menuEl}
		role="menu"
		style={floatingStyle(pos)}
		onmousedown={(e) => e.stopPropagation()}
	>
		{#if title}
			<div class="ui-menu-header">{title}</div>
		{/if}
		{@render content()}
	</div>
{/if}

<style>
	.dropdown {
		position: relative;
		display: inline-flex;
	}

	/* 定位与尺寸都写在 ui-base 的 .ui-menu 与内联样式里，这里只兜底滚动 */
	:global(.ui-menu) {
		max-height: min(60vh, 24rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
</style>
