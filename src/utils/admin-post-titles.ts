/**
 * 已存在文章标题的轻量缓存。
 *
 * 用途：编辑页在标题输入框下方即时提示「标题已存在」，保存前再做一次拦截。
 * 两个地方（输入提示 / 保存校验）共用同一份缓存，避免每次输入都打一次接口。
 *
 * 注意：只比较标题，不比较 slug —— 用户要防的是「两篇文章显示同名」，
 * slug 由系统按标题生成，重名会直接落成同一个文件（已由服务端同名拦截兜住）。
 */

export interface PostTitleEntry {
	slug: string;
	title: string;
}

const TTL_MS = 30_000;

let cache: { at: number; items: PostTitleEntry[] } | null = null;
let inflight: Promise<PostTitleEntry[]> | null = null;

export function normalizeTitle(title: string): string {
	return title.trim().toLowerCase();
}

/** 拉取标题清单（带 30s 缓存）；失败时返回空数组，不阻断编辑 */
export async function loadPostTitles(force = false): Promise<PostTitleEntry[]> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.items;
	if (inflight) return inflight;

	inflight = (async () => {
		try {
			const res = await fetch("/api/admin/posts/", { cache: "no-store" });
			const data = await res.json();
			const posts: Array<{ slug?: string; title?: string }> = Array.isArray(
				data?.posts,
			)
				? data.posts
				: [];
			const items = posts
				.map((post) => ({
					slug: String(post.slug ?? ""),
					title: String(post.title ?? ""),
				}))
				.filter((item) => item.slug && item.title);
			cache = { at: Date.now(), items };
			return items;
		} catch {
			return cache?.items ?? [];
		} finally {
			inflight = null;
		}
	})();

	return inflight;
}

/** 标题冲突检测：排除自己（编辑时标题不变不算冲突） */
export function findTitleConflict(
	items: PostTitleEntry[],
	title: string,
	selfSlug?: string,
): PostTitleEntry | null {
	const target = normalizeTitle(title);
	if (!target) return null;
	return (
		items.find(
			(item) =>
				normalizeTitle(item.title) === target &&
				(!selfSlug || item.slug !== selfSlug),
		) ?? null
	);
}

/** 保存成功/新建后让缓存失效，下一次读取拿到最新清单 */
export function invalidatePostTitles(): void {
	cache = null;
}
