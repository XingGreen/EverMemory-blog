import { getCollection } from "astro:content";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { isValidPostSlug } from "@/utils/github-app";
import { getStorageProvider } from "@/utils/providers/registry";
import { getStoredDraft } from "@/utils/post-draft-store";

export const prerender = false;

/**
 * 极简 frontmatter 解析：只处理本项目 buildFrontmatter 写出的形态
 * （`key: value` 标量 + tags 的行内数组/块式列表）。
 * 不引第三方 YAML 依赖——它在线上不会被打包，用不了。
 */
function parseFrontmatter(raw: string): {
	scalars: Record<string, string>;
	tags: string[];
} {
	const matched = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!matched) return { scalars: {}, tags: [] };

	const body = matched[1];
	const scalars: Record<string, string> = {};
	const tags: string[] = [];

	for (const line of body.split(/\r?\n/)) {
		const pair = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
		if (!pair) continue;
		const [, key, value] = pair;
		const trimmed = value.trim();
		if (key === "tags") {
			const inline = trimmed.match(/^\[(.*)\]$/);
			if (inline) {
				for (const rawTag of inline[1].split(",")) {
					const tag = rawTag.trim().replace(/^["'](.*)["']$/, "$1");
					if (tag) tags.push(tag);
				}
			}
			continue;
		}
		scalars[key] = trimmed.replace(/^["'](.*)["']$/, "$1");
	}

	/* 块式 tags：
	   tags:
	     - a
	     - b */
	if (tags.length === 0) {
		const block = body.match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
		if (block) {
			for (const line of block[1].split(/\r?\n/)) {
				const tag = line
					.replace(/^\s*-\s*/, "")
					.trim()
					.replace(/^["'](.*)["']$/, "$1");
				if (tag) tags.push(tag);
			}
		}
	}

	return { scalars, tags };
}

export async function GET({ request, url }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const slug = url.searchParams.get("slug");

		if (!slug) {
			return new Response(
				JSON.stringify({ success: false, message: "缺少文章标识" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		if (!isValidPostSlug(slug)) {
			return new Response(
				JSON.stringify({ success: false, message: "文章标识不合法" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const posts = await getCollection("posts");
		const post = posts.find((p) => p.id === slug);
		/* 只在集合里找不到时才查云端草稿：草稿不参与构建，线上它只能存在于 KV */
		const storedDraft = post ? null : await getStoredDraft(slug);

		if (!post && !storedDraft) {
			return new Response(
				JSON.stringify({ success: false, message: "文章不存在" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		/* 先解析真实路径：可能是 .md，也可能是 .mdx（内容集合两种都收）。
		   云端草稿自带路径，直接沿用，避免按 slug 猜错扩展名。 */
		const storage = getStorageProvider();
		const resolved = post
			? storage.resolvePath
				? await storage.resolvePath(slug)
				: null
			: (storedDraft?.filePath ?? null);

		if (post && !resolved) {
			return new Response(
				JSON.stringify({ success: false, message: "文章文件不存在" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		/* 本地可读就读盘；只读部署（Vercel / Workers）下项目目录没有源码，回源 GitHub；
		   两边都没有时用云端草稿 —— 这正是「线上打不开草稿」的修复点。 */
		let raw: string | null = null;
		if (resolved) {
			const localPath = path.resolve(process.cwd(), resolved);
			if (fs.existsSync(localPath)) {
				raw = fs.readFileSync(localPath, "utf-8");
			} else {
				const read = await storage.readFile(resolved);
				raw = read.ok ? read.content : null;
			}
		}
		if (raw === null && storedDraft) raw = storedDraft.content;

		if (raw === null) {
			return new Response(
				JSON.stringify({ success: false, message: "文章文件不存在" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		const frontmatterEnd = raw.indexOf("---", 3);
		const bodyContent =
			frontmatterEnd !== -1 ? raw.slice(frontmatterEnd + 3).trim() : raw;

		/* 集合命中时用 Astro 已解析好的元数据；云端草稿没有集合条目，
		   现场解析 frontmatter 补齐同样的字段 */
		let meta: {
			title: string;
			author: string;
			category: string;
			tags: string[];
			published: string;
			updated: string;
			draft: boolean;
			description: string;
			image: string;
			pinned: boolean;
			lang: string;
			licenseName: string;
			licenseUrl: string;
			sourceLink: string;
			comment: boolean;
			password: string;
			passwordHint: string;
		};

		if (post) {
			meta = {
				title: post.data.title,
				author: post.data.author || "",
				category: post.data.category || "",
				tags: post.data.tags || [],
				published: post.data.published.toISOString().split("T")[0],
				updated: post.data.updated?.toISOString().split("T")[0] || "",
				draft: post.data.draft || false,
				description: post.data.description || "",
				image: post.data.image || "",
				pinned: post.data.pinned || false,
				lang: post.data.lang || "",
				licenseName: post.data.licenseName || "",
				licenseUrl: post.data.licenseUrl || "",
				sourceLink: post.data.sourceLink || "",
				comment: post.data.comment !== false,
				password: post.data.password || "",
				passwordHint: post.data.passwordHint || "",
			};
		} else {
			const parsed = parseFrontmatter(raw);
			const asDate = (value: string): string => value.slice(0, 10);
			meta = {
				title: parsed.scalars.title ?? "",
				author: parsed.scalars.author ?? "",
				category: parsed.scalars.category ?? "",
				tags: parsed.tags,
				published: asDate(parsed.scalars.published ?? ""),
				updated: asDate(parsed.scalars.updated ?? ""),
				draft: parsed.scalars.draft === "true",
				description: parsed.scalars.description ?? "",
				image: parsed.scalars.image ?? "",
				pinned: parsed.scalars.pinned === "true",
				lang: parsed.scalars.lang ?? "",
				licenseName: parsed.scalars.licenseName ?? "",
				licenseUrl: parsed.scalars.licenseUrl ?? "",
				sourceLink: parsed.scalars.sourceLink ?? "",
				comment: parsed.scalars.comment !== "false",
				password: parsed.scalars.password ?? "",
				passwordHint: parsed.scalars.passwordHint ?? "",
			};
		}

		return new Response(
			JSON.stringify({
				success: true,
				content: bodyContent,
				frontmatter: meta,
				filePath: resolved ?? undefined,
				/* 云端草稿读出来的：前端可据此提示「当前内容来自云端」 */
				cloud: Boolean(storedDraft),
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		console.error(
			"[Admin PostContent] Exception:",
			error instanceof Error ? error.stack : error,
		);
		return new Response(
			JSON.stringify({
				success: false,
				message: "获取文章内容失败",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
