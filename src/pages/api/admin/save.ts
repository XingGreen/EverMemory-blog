import { requireAuth } from "@/utils/auth";
import { saveFileLocally, saveFileToGitHub } from "@/utils/github-app";

export const prerender = false;

export async function POST({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const body = await request.json();
		const {
			slug,
			content,
			title,
			author,
			category,
			tags,
			published,
			description,
			image,
			draft,
		} = body;

		if (!slug || !content) {
			return new Response(
				JSON.stringify({ success: false, message: "缺少必要参数" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const filePath = `src/content/posts/${slug}.md`;

		const frontmatter = buildFrontmatter({
			title,
			author,
			category,
			tags,
			published,
			description,
			image,
			draft,
		});

		const fullContent = `---\n${frontmatter}\n---\n\n${content}`;

		const commitMessage = `update post: ${title || slug} via admin dashboard`;

		// 1. 先保存到本地文件系统（优先本地，保证开发体验）
		const localSuccess = saveFileLocally(filePath, fullContent);

		// 2. 再保存到 GitHub
		const githubSuccess = await saveFileToGitHub(
			filePath,
			fullContent,
			commitMessage,
		);

		if (localSuccess || githubSuccess) {
			return new Response(
				JSON.stringify({
					success: true,
					message: githubSuccess
						? "保存成功（已同步到 GitHub）"
						: "保存成功（仅本地保存）",
					filePath,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				success: false,
				message: "保存失败（本地和 GitHub 均失败）",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		return new Response(
			JSON.stringify({
				success: false,
				message: "保存失败",
				error: error instanceof Error ? error.message : String(error),
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}

function buildFrontmatter(data: {
	title?: string;
	author?: string;
	category?: string;
	tags?: string[];
	published?: string;
	description?: string;
	image?: string;
	draft?: boolean;
}): string {
	const lines: string[] = [];

	if (data.title) lines.push(`title: "${escapeYaml(data.title)}"`);
	if (data.author) lines.push(`author: "${escapeYaml(data.author)}"`);
	if (data.category) lines.push(`category: "${escapeYaml(data.category)}"`);
	if (data.tags && data.tags.length > 0) {
		const tagsStr = data.tags.map((t) => `"${escapeYaml(t)}"`).join(", ");
		lines.push(`tags: [${tagsStr}]`);
	}
	if (data.published) lines.push(`published: ${data.published}`);
	if (data.description)
		lines.push(`description: "${escapeYaml(data.description)}"`);
	if (data.image) lines.push(`image: "${escapeYaml(data.image)}"`);
	if (data.draft !== undefined) lines.push(`draft: ${data.draft}`);
	lines.push("pinned: false");

	return lines.join("\n");
}

function escapeYaml(str: string): string {
	return str.replace(/"/g, '\\"');
}
