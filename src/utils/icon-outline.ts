/**
 * 导航图标统一空心化：前台导航栏的图标全部使用 outline 变体。
 * 仅改写 material-symbols 系列（该集合有对应的 -outline 变体）；
 * 品牌图标（fa7-brands 等）没有空心概念，原样返回。
 */
export function toOutlineIcon(name: string): string {
	if (!name.startsWith("material-symbols:")) return name;
	const rest = name.slice("material-symbols:".length);
	if (rest.endsWith("-outline")) return name;
	if (rest.endsWith("-rounded")) {
		return `material-symbols:${rest.slice(0, -"-rounded".length)}-outline-rounded`;
	}
	return `material-symbols:${rest}-outline`;
}
