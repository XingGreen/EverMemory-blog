/**
 * 文章 slug 的唯一归一处。
 *
 * 背景：同一个文件在多处的"名字"不一样，已经因此踩过三次坑——
 *   getCollection("posts")  把 guide/index.md 的 id 折叠成  guide
 *   直接切远端路径           得到 guide/index
 *
 * 不统一就会把同一个文件当成两篇：列表里多一条幽灵文章、
 * 同步面板里同一文件既「仅本地」又「仅远端」、diff 却显示两边都有内容。
 *
 * 所有需要 slug 与路径互转的地方都应走这里，不要再各写一遍 replace 链。
 */

const POSTS_PREFIX = "src/content/posts/";

/** 统一 slug：去掉结尾的 /index，使 a/b/index.md 与 a/b 等价 */
export function normalizeSlug(slug: string): string {
	return slug.replace(/\/index$/, "");
}

/** 从仓库相对路径取 slug：src/content/posts/guide/index.md → guide */
export function slugFromPath(filePath: string): string {
	const bare = filePath.startsWith(POSTS_PREFIX)
		? filePath.slice(POSTS_PREFIX.length)
		: filePath;
	return normalizeSlug(bare.replace(/\.mdx?$/, ""));
}

/**
 * slug 反查仓库相对路径。
 * 因为 slug 抹掉了 /index，反查时要探测 index 形式；
 * 传入 knownExt 可避免在 md / mdx 之间猜错。
 */
export function pathFromSlug(
	slug: string,
	options: { ext?: "md" | "mdx"; asIndex?: boolean } = {},
): string {
	const { ext = "md", asIndex = false } = options;
	const tail = asIndex ? `${slug}/index.${ext}` : `${slug}.${ext}`;
	return `${POSTS_PREFIX}${tail}`;
}

/** 是否为 index 形式的 slug（信息性判断，用于决定写入哪条路径） */
export function isIndexSlug(slug: string): boolean {
	return slug.endsWith("/index") || slug === "index";
}
