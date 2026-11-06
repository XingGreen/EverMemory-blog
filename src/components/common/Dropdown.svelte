<script lang="ts">
import type { Snippet } from "svelte";

/**
 * 下拉菜单外壳。
 *
 * 只负责开合、定位、点击外部与 Esc 关闭，视觉在 ui-base 的 .ui-menu。
 *
 * 为什么用 fixed + 挂到 body，而不是 absolute 留在原地：
 *   后台的 .admin-page / .md3-list 都有 overflow，absolute 菜单会被裁掉；
 *   而 .admin-content 带 zoom，祖先里的 getBoundingClientRect() 返回的是放大后的
 *   视觉坐标，fixed 偏移又在这个 zoom 空间里再乘一次，菜单会随位置线性漂移。
 *   挂到 body 后 rect 与 fixed 偏移同在视口坐标系，也不受任何祖先裁剪。
 *   这套算法与 PostRowMenu 一致。
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
let pos = $state<{
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
	zoom: number;
	flip: boolean;
} | null>(null);

/* 触发器所在 zoom 容器相对视口的缩放比。
   取容器而非触发器：小尺寸元素取整误差会被放大。 */
function hostZoom(el: HTMLElement): number {
	const host = el.closest<HTMLElement>(".admin-content");
	if (!host) return 1;
	const visual = host.getBoundingClientRect().width;
	const layout = host.offsetWidth;
	return layout > 0 && visual > 0 ? visual / layout : 1;
}

function place() {
	if (!rootEl) return;
	const rect = rootEl.getBoundingClientRect();
	/* clientWidth/clientHeight 不含滚动条，避免页面出现滚动条后右缘偏一截 */
	const vw = document.documentElement.clientWidth;
	const vh = document.documentElement.clientHeight;
	/* 距底不足 200px 就向上弹：菜单 176px 起步，留点余量 */
	const flip = vh - rect.bottom < 200;
	const horizontal =
		align === "end"
			? { right: Math.max(8, vw - rect.right) }
			: { left: rect.left };

	pos = {
		...horizontal,
		...(flip ? { bottom: vh - rect.top + 4 } : { top: rect.bottom + 4 }),
		zoom: hostZoom(rootEl),
		flip,
	};
}

function toggle() {
	if (open) {
		open = false;
		pos = null;
		return;
	}
	place();
	open = true;
}

/* 菜单节点搬到 body：脱离所有 overflow 祖先，也不受 zoom 空间影响 */
$effect(() => {
	const el = menuEl;
	if (!el) return;
	if (el.parentElement !== document.body) document.body.appendChild(el);
	return () => {
		el.remove();
	};
});

/* 调用方直接改 open 时也要补一次定位（不是所有入口都走 toggle） */
$effect(() => {
	if (open && !pos) place();
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
	/* 滚动或改尺寸时直接收起：菜单是 fixed，不跟随内容移动 */
	const onViewportChange = () => {
		open = false;
	};

	document.addEventListener("mousedown", onPointerDown);
	document.addEventListener("keydown", onKeyDown);
	window.addEventListener("scroll", onViewportChange, true);
	window.addEventListener("resize", onViewportChange);
	return () => {
		document.removeEventListener("mousedown", onPointerDown);
		document.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("scroll", onViewportChange, true);
		window.removeEventListener("resize", onViewportChange);
	};
});
</script>

<div class="dropdown" bind:this={rootEl}>
	{@render trigger()}
</div>

{#if open && pos}
	<div
		class="ui-menu dropdown-menu"
		bind:this={menuEl}
		role="menu"
		style:top={pos.top !== undefined ? `${pos.top / pos.zoom}px` : undefined}
		style:bottom={pos.bottom !== undefined
			? `${pos.bottom / pos.zoom}px`
			: undefined}
		style:left={pos.left !== undefined ? `${pos.left / pos.zoom}px` : undefined}
		style:right={pos.right !== undefined
			? `${pos.right / pos.zoom}px`
			: undefined}
		style:zoom={pos.zoom}
		style:transform-origin={pos.flip ? "bottom right" : "top right"}
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

	/* 挂到 body 后不再受 .dropdown 约束，定位由行内样式给出 */
	.dropdown-menu {
		position: fixed;
	}
</style>
