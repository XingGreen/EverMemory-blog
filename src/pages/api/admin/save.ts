import { saveFileToGitHub, saveFileLocally, isValidPostSlug } from "@/utils/github-app";
import { requireAuth } from "@/utils/auth";

export const prerender = false;

export async function POST({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const body = await request.json();
		const {
			slug, content, title, author, category, tags,
			published, updated, description, image, lang,
			licenseName, licenseUrl, sourceLink, comment,
			password, passwordHint, draft, pinned,
		} = body;

		if (!slug || !content) {
			return new Response(
				JSON.stringify({ success: false, message: "缺少必要参数" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		if (!isValidPostSlug(slug)) {
			return new Response(
				JSON.stringify({ success: false, message: "文章标识不合法" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const filePath = `src/content/posts/${slug}.md`;

		const frontmatter = buildFrontmatter({
			title, author, category, tags,
			published, updated, description, image, lang,
			licenseName, licenseUrl, sourceLink, comment,
			password, passwordHint, draft, pinned,
		});

		const fullContent = `---\n${frontmatter}\n---\n\n${content}`;

		const commitMessage = `update post: ${title || slug} via admin dashboard`;

		// 1. 先保存到本地文件系统（优先本地，保证开发体验）
		const localSuccess = saveFileLocally(filePath, fullContent);

		// 2. 再保存到 GitHub
		const githubSuccess = await saveFileToGitHub(filePath, fullContent, commitMessage);

		if (localSuccess || githubSuccess) {
			return new Response(
				JSON.stringify({
					success: true,
					message: githubSuccess ? "保存成功（已同步到 GitHub）" : "保存成功（仅本地保存）",
					filePath,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({ success: false, message: "保存失败（本地和 GitHub 均失败）" }),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		console.error("[Admin Save] Exception:", error instanceof Error ? error.stack : error);
		return new Response(
			JSON.stringify({
				success: false,
				message: "保存失败",
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
	updated?: string;
	description?: string;
	image?: string;
	lang?: string;
	licenseName?: string;
	licenseUrl?: string;
	sourceLink?: string;
	comment?: boolean;
	password?: string;
	passwordHint?: string;
	draft?: boolean;
	pinned?: boolean;
}): string {
	const lines: string[] = [];

	if (data.title) lines.push(`title: "${escapeYaml(data.title)}"`);
	if (data.published) lines.push(`published: ${data.published}`);
	if (data.updated) lines.push(`updated: ${data.updated}`);
	if (data.description) lines.push(`description: "${escapeYaml(data.description)}"`);
	if (data.image) lines.push(`image: "${escapeYaml(data.image)}"`);
	if (data.tags && data.tags.length > 0) {
		const tagsStr = data.tags.map((t) => `"${escapeYaml(t)}"`).join(", ");
		lines.push(`tags: [${tagsStr}]`);
	}
	if (data.category) lines.push(`category: "${escapeYaml(data.category)}"`);
	if (data.lang) lines.push(`lang: "${escapeYaml(data.lang)}"`);
	if (data.author) lines.push(`author: "${escapeYaml(data.author)}"`);
	if (data.licenseName) lines.push(`licenseName: "${escapeYaml(data.licenseName)}"`);
	if (data.licenseUrl) lines.push(`licenseUrl: "${escapeYaml(data.licenseUrl)}"`);
	if (data.sourceLink) lines.push(`sourceLink: "${escapeYaml(data.sourceLink)}"`);
	if (data.draft !== undefined) lines.push(`draft: ${data.draft}`);
	lines.push(`pinned: ${data.pinned ?? false}`);
	if (data.comment !== undefined) lines.push(`comment: ${data.comment}`);
	if (data.password) lines.push(`password: "${escapeYaml(data.password)}"`);
	if (data.passwordHint) lines.push(`passwordHint: "${escapeYaml(data.passwordHint)}"`);

	return lines.join("\n");
}

function escapeYaml(str: string): string {
	return str.replace(/"/g, '\\"');
}
