/**
 * 浮层定位的公共计算。
 *
 * 后台的 .admin-content 带 zoom，子树里 getBoundingClientRect() 返回的是放大后的
 * 视觉坐标，而 fixed 偏移又在这个 zoom 空间里再乘一次。所以坐标要按 zoom 折算，
 * 菜单自身也要按同样比例缩放，两者才能对齐。
 *
 * 与 PostRowMenu 里那套算法一致，抽出来给 Dropdown 与 Select 共用。
 */

/** 触发器所在 zoom 容器相对视口的缩放比；取容器而非触发器，小尺寸取整误差会被放大 */
export function hostZoom(el: HTMLElement): number {
	const host = el.closest<HTMLElement>(".admin-content");
	if (!host) return 1;
	const visual = host.getBoundingClientRect().width;
	const layout = host.offsetWidth;
	return layout > 0 && visual > 0 ? visual / layout : 1;
}

export interface FloatingPosition {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
	zoom: number;
	flip: boolean;
}

/**
 * 计算贴住触发器下方的坐标（空间不足时翻到上方）。
 *
 * @param anchor   触发器元素
 * @param align    横向对齐方式："end" 右对齐，"start" 左对齐
 * @param flipNeed 距视口底部小于这个值时向上弹
 */
export function placeUnder(
	anchor: HTMLElement,
	align: "start" | "end" = "end",
	flipNeed = 200,
): FloatingPosition {
	const rect = anchor.getBoundingClientRect();
	/* clientWidth/clientHeight 不含滚动条，页面有滚动条时右缘不会偏一截 */
	const vw = document.documentElement.clientWidth;
	const vh = document.documentElement.clientHeight;
	const flip = vh - rect.bottom < flipNeed;

	return {
		...(align === "end"
			? { right: Math.max(8, vw - rect.right) }
			: { left: rect.left }),
		...(flip ? { bottom: vh - rect.top + 4 } : { top: rect.bottom + 4 }),
		zoom: hostZoom(anchor),
		flip,
	};
}

/** 把计算结果摊成内联样式；坐标与缩放分别折算 */
export function floatingStyle(pos: FloatingPosition): string {
	const unit = (v: number | undefined) =>
		v === undefined ? "" : `${v / pos.zoom}px`;
	return [
		"position: fixed",
		`top: ${unit(pos.top)}`,
		`bottom: ${unit(pos.bottom)}`,
		`left: ${unit(pos.left)}`,
		`right: ${unit(pos.right)}`,
		`zoom: ${pos.zoom}`,
		`transform-origin: ${pos.flip ? "bottom" : "top"} right`,
	]
		.filter((s) => !s.endsWith(": "))
		.join("; ");
}

/**
 * 把节点挂到 body。
 *
 * 菜单留原地会被 .admin-page 的 overflow: hidden 与 .md3-list 的 overflow: auto
 * 裁掉；挂出去后 rect 与 fixed 偏移同在视口坐标系，也不受任何祖先裁剪。
 */
export function portalToBody(node: HTMLElement): void {
	if (node.parentElement !== document.body) document.body.appendChild(node);
}
