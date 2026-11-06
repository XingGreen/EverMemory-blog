<script lang="ts">
import type { Snippet } from "svelte";

/**
 * 下拉菜单的通用外壳。
 *
 * 只负责开合、点击外部收起、Esc 关闭与浮层对齐，不含任何视觉——
 * 浮层与选项的外观在 ui-base 的 .ui-menu / .ui-menu-item，
 * 内容（单选列表、多选开关、操作菜单）由使用方决定。
 *
 * 与 Select 的分工：Select 是「选一个值」的表单控件，内置键盘导航；
 * 这里只提供结构，适合菜单这类语义。
 */
let {
	open = $bindable(false),
	align = "end",
	children,
}: {
	open?: boolean;
	align?: "start" | "end";
	children: Snippet;
} = $props();

let rootEl = $state<HTMLElement | null>(null);

$effect(() => {
	if (!open) return;

	/* mousedown 而非 click：拖选文本时鼠标在外部松开，click 的 target
	   可能落在内部，导致该关的时候没关 */
	const onPointerDown = (e: MouseEvent) => {
		if (!rootEl?.contains(e.target as Node)) open = false;
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") open = false;
	};

	document.addEventListener("mousedown", onPointerDown);
	document.addEventListener("keydown", onKeyDown);
	return () => {
		document.removeEventListener("mousedown", onPointerDown);
		document.removeEventListener("keydown", onKeyDown);
	};
});
</script>

<div class="dropdown" data-align={align} bind:this={rootEl}>
	{@render children()}
</div>

<style>
	.dropdown {
		position: relative;
		display: inline-flex;
	}

	/* 浮层贴住触发器下方 */
	.dropdown > :global(.ui-menu) {
		top: calc(100% + 0.5rem);
	}

	.dropdown[data-align="start"] > :global(.ui-menu) {
		left: 0;
	}

	.dropdown[data-align="end"] > :global(.ui-menu) {
		right: 0;
	}
</style>
