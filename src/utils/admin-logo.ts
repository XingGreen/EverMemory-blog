import path from "node:path";
import type { ImageMetadata } from "astro";
import { siteConfig } from "@/config/siteConfig";

export type AdminLogo = {
	type: "icon" | "image" | "url";
	value: string;
	alt: string;
	followTheme: boolean;
	src: string | null;
};

/**
 * 解析前台导航栏 Logo（siteConfig.navbar.logo）供后台侧边栏品牌区复用。
 * 与 Navbar.astro 同一套逻辑：src 目录图片走 import.meta.glob 取优化后的 URL，
 * 路径不在此处硬编码——增删/改名图片只需改 siteConfig。
 */
export async function resolveAdminLogo(): Promise<AdminLogo> {
	const logo = siteConfig.navbar.logo;
	const type = logo?.type ?? "icon";
	const value = logo?.value ?? "material-symbols:home-pin-outline";
	const alt = logo?.alt ?? siteConfig.title;
	let src: string | null = null;

	if (
		type === "image" &&
		value &&
		!value.startsWith("/") &&
		!value.startsWith("http")
	) {
		const files = import.meta.glob<ImageMetadata>(
			"../assets/**/*.{png,jpg,jpeg,webp,avif,gif,svg}",
			{ import: "default" },
		);
		const relative = value.replace(/^assets\//, "");
		const normalizedPath = path
			.normalize(path.join("../assets/", relative))
			.replace(/\\/g, "/");
		const file = files[normalizedPath];
		if (file) {
			src = (await file()).src;
		}
	}

	return {
		type,
		value,
		alt,
		followTheme: Boolean(siteConfig.navbar.followTheme),
		src,
	};
}
