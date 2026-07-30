import { deleteFileFromGitHub } from "@/utils/github-app";
import { requireAuth } from "@/utils/auth";

export const prerender = false;

export async function POST({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const body = await request.json();
		const { slug, title } = body;

		if (!slug) {
			return new Response(
				JSON.stringify({ success: false, message: "缺少文章标识" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		console.log(`[Admin Delete] Slug: ${slug}`);
		
		const filePath = `src/content/posts/${slug}.md`;
		const commitMessage = `delete post: ${title || slug} via admin dashboard`;

		await deleteFileFromGitHub(filePath, commitMessage);

		console.log(`[Admin Delete] Successfully deleted: ${slug}`);
		return new Response(
			JSON.stringify({
				success: true,
				message: "删除成功",
				filePath,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.log(`[Admin Delete] Exception: ${errorMessage}`);
		console.log(`[Admin Delete] Stack: ${error instanceof Error ? error.stack : "no stack"}`);
		return new Response(
			JSON.stringify({
				success: false,
				message: `删除失败: ${errorMessage}`,
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
