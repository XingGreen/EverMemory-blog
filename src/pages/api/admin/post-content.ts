import { getCollection } from "astro:content";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { isValidPostSlug } from "@/utils/github-app";

export const prerender = false;

export async function GET({ request, url }) {
	const auth = requireAuth(request);
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

		if (!post) {
			return new Response(
				JSON.stringify({ success: false, message: "文章不存在" }),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		const filePath = path.resolve(process.cwd(), `src/content/posts/${slug}.md`);

		if (fs.existsSync(filePath)) {
			const content = fs.readFileSync(filePath, "utf-8");

			const frontmatterEnd = content.indexOf("---", 3);
			const bodyContent = frontmatterEnd !== -1 ? content.slice(frontmatterEnd + 3).trim() : content;

			return new Response(
				JSON.stringify({
					success: true,
					content: bodyContent,
					frontmatter: {
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
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({ success: false, message: "文章文件不存在" }),
			{ status: 404, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		console.error("[Admin PostContent] Exception:", error instanceof Error ? error.stack : error);
		return new Response(
			JSON.stringify({
				success: false,
				message: "获取文章内容失败",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
