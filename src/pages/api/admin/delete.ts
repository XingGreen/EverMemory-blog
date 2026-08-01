import { deleteFileFromGitHub, deleteFileLocally } from "@/utils/github-app";
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

		// 1. 先删除本地文件（优先本地，保证开发体验）
		const localSuccess = deleteFileLocally(filePath);

		// 2. 再删除 GitHub 上的文件（捕获异常，不因为 GitHub 失败而影响整体）
		let githubError: string | null = null;
		try {
			await deleteFileFromGitHub(filePath, commitMessage);
		} catch (err) {
			githubError = err instanceof Error ? err.message : String(err);
			console.log(`[Admin Delete] GitHub delete failed (but local was deleted): ${githubError}`);
		}

		// 只要本地删除成功就算成功（GitHub 失败时给出提示）
		if (localSuccess) {
			return new Response(
				JSON.stringify({
					success: true,
					message: githubError
						? `删除成功（已删除本地文件，但 GitHub 同步失败：${githubError}）`
						: "删除成功（已同步到 GitHub）",
					filePath,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				success: false,
				message: "删除失败（本地和 GitHub 均失败）",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
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
