import { requireAuth } from "@/utils/auth";
import { IS_PROD_BUILD } from "@/utils/env";
import {
	deleteFileFromGitHub,
	deleteFileLocally,
	isValidPostSlug,
	resolvePostPath,
} from "@/utils/github-app";

export const prerender = false;

export async function POST({ request }) {
	const auth = await requireAuth(request);
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

		if (!isValidPostSlug(slug)) {
			return new Response(
				JSON.stringify({ success: false, message: "文章标识不合法" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		console.log(`[Admin Delete] Slug: ${slug}`);

		/* 解析真实路径：mdx 文章若按 .md 去删会删不到（并误报） */
		const filePath =
			(await resolvePostPath(slug)) ?? `src/content/posts/${slug}.md`;
		const commitMessage = `delete post: ${title || slug} via admin dashboard`;

		/* 1. 本地文件只在开发构建下可删：生产（Vercel / Workers）目录只读，
		      与 save.ts 同一假设。 */
		const localSuccess = IS_PROD_BUILD
			? false
			: deleteFileLocally(filePath);

		// 2. 再删除 GitHub 上的文件（捕获异常，不因为 GitHub 失败而影响整体）
		let githubSuccess = false;
		let githubError: string | null = null;
		try {
			await deleteFileFromGitHub(filePath, commitMessage);
			githubSuccess = true;
		} catch (err) {
			githubError = err instanceof Error ? err.message : String(err);
			console.log(
				`[Admin Delete] GitHub delete failed (but local was deleted): ${githubError}`,
			);
		}

		/* 任一条通道成功即算成功。此前只看 localSuccess：生产目录只读时它恒为
		   false，于是「GitHub 已删掉、本地删不了」会被报成 500 删除失败——线上
		   删除文章必然误报。 */
		if (localSuccess || githubSuccess) {
			return new Response(
				JSON.stringify({
					success: true,
					local: localSuccess,
					remote: githubSuccess,
					message: githubSuccess
						? "删除成功（已同步到 GitHub）"
						: `删除成功（已删除本地文件，但 GitHub 同步失败：${githubError}）`,
					filePath,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				success: false,
				local: false,
				remote: false,
				message: "删除失败（本地和 GitHub 均失败）",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.log(`[Admin Delete] Exception: ${errorMessage}`);
		console.log(
			`[Admin Delete] Stack: ${error instanceof Error ? error.stack : "no stack"}`,
		);
		return new Response(
			JSON.stringify({
				success: false,
				message: "删除失败",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
