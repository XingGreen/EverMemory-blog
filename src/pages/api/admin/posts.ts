import { getCollection } from "astro:content";
import { requireAuth } from "@/utils/auth";

export const prerender = false;

export async function GET({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const posts = await getCollection("posts");

		const postsData = posts
			.map((post) => ({
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
				image: post.data.image || "",
				pinned: post.data.pinned || false,
				filePath: `src/content/posts/${post.id}.md`,
			}))
			.sort((a, b) => {
				if (a.draft !== b.draft) return a.draft ? 1 : -1;
				return (
					new Date(b.published).getTime() - new Date(a.published).getTime()
				);
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
