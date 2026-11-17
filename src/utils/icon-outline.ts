import iconsData from "@iconify-json/material-symbols/icons.json";

/**
 * 导航图标统一空心化：前台导航栏的图标全部使用 outline 变体。
 * 仅改写 material-symbols 系列；品牌图标（fa7-brands 等）没有空心概念，
 * 原样返回。
 *
 * 集合内并非每个图标都有全部变体组合（例如有 tag-outline 而没有
 * tag-outline-rounded），所以候选名必须逐级校验：outline-rounded →
 * outline → 原名，绝不产出数据里不存在的图标名。
 */
const materialSymbols = iconsData as {
	icons: Record<string, unknown>;
	aliases?: Record<string, unknown>;
};

function exists(name: string): boolean {
	const short = name.slice("material-symbols:".length);
	return Boolean(
		materialSymbols.icons[short] || materialSymbols.aliases?.[short],
	);
}

export function toOutlineIcon(name: string): string {
	if (!name.startsWith("material-symbols:")) return name;
	const rest = name.slice("material-symbols:".length);
	if (rest.endsWith("-outline")) return name;
	if (rest.endsWith("-rounded")) {
		const base = rest.slice(0, -"-rounded".length);
		const rounded = `material-symbols:${base}-outline-rounded`;
		if (exists(rounded)) return rounded;
		const plain = `material-symbols:${base}-outline`;
		if (exists(plain)) return plain;
		return name;
	}
	const plain = `material-symbols:${rest}-outline`;
	return exists(plain) ? plain : name;
}
