import { listAllMarkdownFiles, getFileFromGitHub, saveFileLocally } from "@/utils/github-app";
import { requireAuth } from "@/utils/auth";
import { getCollection } from "astro:content";
import path from "node:path";

export const prerender = false;

export async function POST({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		console.log("[Admin Sync] Starting sync...");

		// 1. 从 GitHub 获取所有 .md 文件列表
		const githubFiles = await listAllMarkdownFiles("src/content/posts");
		console.log(`[Admin Sync] GitHub files: ${githubFiles.length}`);

		// 2. 获取本地已有的文章列表
		const localPosts = await getCollection("posts");
		const localSlugs = new Set(localPosts.map((p) => p.id));
		console.log(`[Admin Sync] Local files: ${localSlugs.size}`);

		// 3. 下载 GitHub 有但本地没有的文件
		let downloaded = 0;
		let downloadedFiles: string[] = [];
		for (const filePath of githubFiles) {
			// 从路径提取 slug（如 src/content/posts/hello.md → hello）
			const slug = path.basename(filePath, ".md");

			if (!localSlugs.has(slug)) {
				console.log(`[Admin Sync] Downloading missing file: ${filePath}`);
				const content = await getFileFromGitHub(filePath);

				if (content) {
					const localPath = filePath.replace(/^src\/content\/posts\//, "src/content/posts/");
					saveFileLocally(localPath, content);
					downloaded++;
					downloadedFiles.push(slug);
				}
			}
		}

		// 4. 检测本地有但 GitHub 没有的文件（仅报告，不自动删除）
		const githubSlugs = new Set(
			githubFiles.map((f) => path.basename(f, ".md"))
		);
		let orphanedFiles: string[] = [];
		for (const localSlug of localSlugs) {
			if (!githubSlugs.has(localSlug)) {
				orphanedFiles.push(localSlug);
			}
		}

		console.log(`[Admin Sync] Downloaded: ${downloaded}, Orphaned: ${orphanedFiles.length}`);

		return new Response(
			JSON.stringify({
				success: true,
				message: `同步完成：从 GitHub 下载 ${downloaded} 篇文章${orphanedFiles.length > 0 ? `，发现 ${orphanedFiles.length} 篇本地独有文章` : ""}`,
				stats: {
					githubTotal: githubFiles.length,
					localTotal: localSlugs.size,
					downloaded,
					orphaned: orphanedFiles.length,
					orphanedFiles,
					downloadedFiles,
				},
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		console.error("[Admin Sync] Exception:", error instanceof Error ? error.stack : error);
		return new Response(
			JSON.stringify({
				success: false,
				message: `同步失败: ${error instanceof Error ? error.message : String(error)}`,
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
