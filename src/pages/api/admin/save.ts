import { saveFileToGitHub } from "@/utils/github-app";
import { requireAuth } from "@/utils/auth";

export const prerender = false;

export async function POST({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const body = await request.json();
		const { slug, content, title, author, category, tags, published, description, image, draft } = body;

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

		const success = await saveFileToGitHub(filePath, fullContent, commitMessage);

		if (success) {
			return new Response(
				JSON.stringify({
					success: true,
					message: "保存成功",
					filePath,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({ success: false, message: "保存失败" }),
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
	if (data.description) lines.push(`description: "${escapeYaml(data.description)}"`);
	if (data.image) lines.push(`image: "${escapeYaml(data.image)}"`);
	if (data.draft !== undefined) lines.push(`draft: ${data.draft}`);
	lines.push(`pinned: false`);

	return lines.join("\n");
}

function escapeYaml(str: string): string {
	return str.replace(/"/g, '\\"');
}
