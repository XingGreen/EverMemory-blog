import path from "node:path";

/**
 * 资源引用的纯函数工具。
 *
 * 单独成文件的原因：这些函数要在 Vitest 里直接测试，而它们原本和
 * `astro:content` 的 getCollection 放在同一模块里——测试环境没有 Astro 虚拟模块，
 * 整个文件都会 import 失败。把纯逻辑拆出来，测试才能真正覆盖到。
 */

/** 允许读取的目录前缀，与 post-asset 接口保持一致 */
export const ALLOWED_PREFIXES = ["src/content/", "public/"];

const ASSET_EXT = new Set([
	".avif",
	".webp",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".svg",
	".bmp",
	".ico",
	".mp4",
	".webm",
	".pdf",
]);

/**
 * 把正文里出现的资源引用抽出来（Markdown 图片/链接 + HTML img/src）。
 * 返回值保留原始写法（含查询串），由调用方决定如何解析。
 */
export function extractAssetRefs(content: string): string[] {
	const refs = new Set<string>();

	// ![alt](path) 与 [text](path)
	for (const m of content.matchAll(/!?\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g)) {
		refs.add(m[1]);
	}
	// <img src="path"> 与其他 src= / href= 指向文件的属性
	for (const m of content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
		refs.add(m[1]);
	}

	/* 过滤：跳过外链、锚点、data URI，只留本地相对/绝对路径 */
	return [...refs].filter((ref) => {
		if (!ref) return false;
		if (/^(https?:|mailto:|tel:|data:|#|\/\/)/i.test(ref)) return false;
		const ext = path.extname(ref.split(/[?#]/)[0]).toLowerCase();
		return ASSET_EXT.has(ext);
	});
}

/**
 * 把正文里的相对引用解析成仓库内路径。
 * 文章位于 src/content/posts/ 下，相对引用以该目录为基准。
 * 越界（不落在 ALLOWED_PREFIXES 内）返回 null。
 */
export function resolveAssetPath(
	rawRef: string,
	postFilePath: string,
	root: string,
	exists: (abs: string) => boolean,
): string | null {
	const clean = rawRef.split(/[?#]/)[0].trim();
	if (!clean) return null;

	let abs: string;
	if (clean.startsWith("/")) {
		// 站点绝对路径：指向 public/
		abs = path.join(root, "public", clean.replace(/^\/+/, ""));
	} else {
		// 相对文章文件所在目录
		abs = path.resolve(root, path.dirname(postFilePath), clean);
	}

	const rel = path.relative(root, abs).replace(/\\/g, "/");
	if (!ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) return null;
	if (!exists(abs)) return null;
	return rel;
}

/** 包内路径：source 去掉前缀，统一放到 assets/ 下 */
export function toPackagePath(source: string): string {
	if (source.startsWith("public/")) {
		return `assets/public/${source.slice("public/".length)}`;
	}
	return `assets/${source.slice("src/content/".length)}`;
}
