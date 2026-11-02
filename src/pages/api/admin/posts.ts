import { getCollection } from "astro:content";
import type { AdminPostSummary } from "@/types/adminApi";
import { requireAuth } from "@/utils/auth";
import { getFileFromGitHub, listAllMarkdownFiles } from "@/utils/github-app";
import { normalizeSlug, slugFromPath } from "@/utils/post-slug";

export const prerender = false;

/* 远端清单缓存：GitHub 的目录接口按层递归请求，列表页每打开一次就打一轮太浪费。
   serverless 实例复用时有效，冷启动重置，属于可接受的尽力缓存。 */
const REMOTE_CACHE_TTL_MS = 60_000;
/** 失败结果单独缓存更短的时间：避免每次进列表页都白等一个超时 */
const REMOTE_FAIL_CACHE_MS = 20_000;
let remoteCache: { at: number; slugs: Map<string, string> | null } | null =
	null;

/** 单次远端清单的耗时上限。超时即降级：宁可没有徽章，也不让列表等下去。 */
const REMOTE_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timeout after ${ms}ms`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

async function getRemoteSlugs(): Promise<Map<string, string> | null> {
	if (remoteCache) {
		const ttl = remoteCache.slugs ? REMOTE_CACHE_TTL_MS : REMOTE_FAIL_CACHE_MS;
		if (Date.now() - remoteCache.at < ttl) return remoteCache.slugs;
	}
	try {
		/* 底层 fetchWithRetry 是 30s 超时 × 3 次重试，对列表页太长；这里整体限时。
		   超时值从 4s 提到 12s：GitHub 要串行拉三个目录，首包 TTFB 加目录遍历
		   经常超过 4s，原来几乎每次都以 timeout 收场，同步状态因此永远标不上，
		   用户看到的就是「明明没网却显示已同步」。
		   拿不到就降级为 null，不能让同步标记决定列表能不能打开。 */
		const paths = await withTimeout(
			listAllMarkdownFiles("src/content/posts"),
			REMOTE_TIMEOUT_MS,
		);
		const slugs = new Map<string, string>();
		for (const filePath of paths) {
			const slug = slugFromPath(filePath);
			slugs.set(slug, filePath);
		}
		remoteCache = { at: Date.now(), slugs };
		return slugs;
	} catch (error) {
		/* 失败也写缓存，否则每次进列表页都要白等一个超时；
		   TTL 用更短的 REMOTE_FAIL_CACHE_MS，让网络恢复后能较快重试。 */
		remoteCache = { at: Date.now(), slugs: null };
		console.warn(
			"[Admin Posts] 远端清单获取失败，本次不标记同步状态：",
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}

/**
 * 读 frontmatter 里的单个标量。只认本项目 buildFrontmatter 写出的 `key: value`
 * 形式，不为此引入 YAML 依赖。
 */
function readFrontmatterValue(raw: string, key: string): string {
	const matched = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	if (!matched) return "";
	return matched[1].trim().replace(/^"(.*)"$/, "$1");
}

/**
 * 远端有、当前内容集合没有的文章：已提交但还没进入这次构建。
 * 只拉差集那几篇的正文（通常 0~2 篇），不从远端补全全部字段——
 * 列表要的是「能看见这篇存在」，正文由 post-content 接口另行回源。
 */
async function buildRemoteOnlyEntries(
	localSlugs: Set<string>,
	remoteSlugs: Map<string, string>,
): Promise<AdminPostSummary[]> {
	const entries: AdminPostSummary[] = [];
	for (const [slug, filePath] of remoteSlugs) {
		if (localSlugs.has(slug)) continue;
		const raw = await getFileFromGitHub(filePath).catch(() => null);
		if (!raw) continue;
		entries.push({
			id: slug,
			slug,
			title: readFrontmatterValue(raw, "title") || slug,
			author: readFrontmatterValue(raw, "author"),
			category: readFrontmatterValue(raw, "category"),
			tags: [] as string[],
			published:
				readFrontmatterValue(raw, "published") || new Date(0).toISOString(),
			updated: null as string | null,
			draft: readFrontmatterValue(raw, "draft") === "true",
			description: readFrontmatterValue(raw, "description"),
			password: readFrontmatterValue(raw, "password"),
			passwordHint: readFrontmatterValue(raw, "passwordHint"),
			comment: readFrontmatterValue(raw, "comment") !== "false",
			image: readFrontmatterValue(raw, "image"),
			pinned: readFrontmatterValue(raw, "pinned") === "true",
			filePath,
			/* 已提交 GitHub，但当前部署的构建产物里还没有 */
			syncState: "pending-deploy" as const,
		});
	}
	return entries;
}

export async function GET({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		/* 本地集合与远端清单并行取：远端受限时最多多等一次网络往返，而不是串行叠加 */
		const [posts, remoteSlugs] = await Promise.all([
			getCollection("posts"),
			getRemoteSlugs(),
		]);
		const localSlugs = new Set(posts.map((post) => normalizeSlug(post.id)));

		const localData = posts.map((post) => ({
			id: post.id,
			slug: post.id,
			title: post.data.title,
			author: post.data.author || "",
			category: post.data.category || "",
			tags: post.data.tags || [],
			published: post.data.published.toISOString(),
			updated: post.data.updated?.toISOString() || null,
			draft: post.data.draft || false,
			description: post.data.description || "",
			password: post.data.password || "",
			passwordHint: post.data.passwordHint || "",
			comment: post.data.comment !== false,
			image: post.data.image || "",
			pinned: post.data.pinned || false,
			filePath: `src/content/posts/${post.id}.md`,
			/* 由下方远端比对填充；远端不可用时保持 null，前端不显示徽章 */
			syncState: null as "deployed" | "not-on-github" | null,
		}));

		let extraPosts: Awaited<ReturnType<typeof buildRemoteOnlyEntries>> = [];

		if (remoteSlugs) {
			for (const item of localData) {
				item.syncState = remoteSlugs.has(normalizeSlug(item.slug))
					? "deployed"
					: "not-on-github";
			}
			extraPosts = await buildRemoteOnlyEntries(localSlugs, remoteSlugs);
		}

		const postsData = [...extraPosts, ...localData].sort((a, b) => {
			if (a.draft !== b.draft) return a.draft ? 1 : -1;
			return new Date(b.published).getTime() - new Date(a.published).getTime();
		});

		return new Response(JSON.stringify({ success: true, posts: postsData }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error(
			"[Admin Posts] Exception:",
			error instanceof Error ? error.stack : error,
		);
		return new Response(
			JSON.stringify({
				success: false,
				message: "获取文章列表失败",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
