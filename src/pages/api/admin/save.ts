import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { IS_PROD_BUILD } from "@/utils/env";
import {
	isValidPostSlug,
	resolvePostPath,
	saveFileLocally,
} from "@/utils/github-app";
import { getStore } from "@/utils/persist-store";

export const prerender = false;

export async function POST({ request }) {
	const auth = await requireAuth(request);
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
			updated,
			description,
			image,
			lang,
			licenseName,
			licenseUrl,
			sourceLink,
			comment,
			password,
			passwordHint,
			draft,
			pinned,
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

		/* 沿用已有文件的扩展名（.md / .mdx）；新建文章没有既有文件，默认 .md */
		const filePath =
			(await resolvePostPath(slug)) ?? `src/content/posts/${slug}.md`;

		const frontmatter = buildFrontmatter({
			title,
			author,
			category,
			tags,
			published,
			updated,
			description,
			image,
			lang,
			licenseName,
			licenseUrl,
			sourceLink,
			comment,
			password,
			passwordHint,
			draft,
			pinned,
		});

		const fullContent = `---\n${frontmatter}\n---\n\n${content}`;

		/* 0. 保存快照——历史版本功能的数据来源。
		      走 persist-store 而不是直接写文件：云端（Vercel / Workers）项目目录只读，
		      fs.writeFile 必然失败，历史版本在线上就是死的。
		      KV / file 由后端自己选，本地开发仍然落 .revisions 目录，行为不变。
		      内容没变也不产生版本，避免重复保存堆出一串空记录。 */
		try {
			const absPath = path.resolve(process.cwd(), filePath);
			let previous: string | null = null;
			if (existsSync(absPath)) previous = readFileSync(absPath, "utf-8");
			if (previous !== fullContent) {
				const savedAt = Date.now();
				/* 存的是保存后的内容（不是 previous）。previous 是「这次保存之前」的
				   样子，用它会让历史列表永远看不到刚设的封面/分类——最新一条反映的是
				   旧状态，用户会以为封面没存进去。存 fullContent 后最新版本即当前状态，
				   恢复语义不变（仍是完整快照）。 */
				await getStore().set(`rev:${slug}:${savedAt}`, {
					content: fullContent,
					reason: "auto",
					savedAt,
				});
			}
		} catch {
			// 快照失败不影响正常保存
		}

		/* 保存只写本地，不推 GitHub。
		   ————————————————————————————————————————————————
		   原来这里无条件调用 saveFileToGitHub，导致「新建/编辑即上线」：
		   文章刚存完就已经在远端，同步面板比对时是 same，看起来像「找不到这篇」。
		   推送权收归同步面板——那里能看到差异、能逐条选方向、能被二次确认拦住。

		   代价：生产环境（项目目录只读）无法保存。这是有意的取舍：
		   写文章应该在本地做，云端只负责看和同步。 */
		const localSuccess = IS_PROD_BUILD
			? false
			: saveFileLocally(filePath, fullContent);

		if (localSuccess) {
			return new Response(
				JSON.stringify({
					success: true,
					local: true,
					remote: false,
					message: "已保存到本地，推送请用同步面板",
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
				message: IS_PROD_BUILD
					? "当前部署环境为只读，无法写入文章。请在本地开发环境编辑并保存"
					: "保存失败：写入本地文件出错",
			}),
			{
				status: IS_PROD_BUILD ? 403 : 500,
				headers: { "Content-Type": "application/json" },
			},
		);
	} catch (error) {
		console.error(
			"[Admin Save] Exception:",
			error instanceof Error ? error.stack : error,
		);
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
	if (data.description)
		lines.push(`description: "${escapeYaml(data.description)}"`);
	if (data.image) lines.push(`image: "${escapeYaml(data.image)}"`);
	if (data.tags && data.tags.length > 0) {
		const tagsStr = data.tags.map((t) => `"${escapeYaml(t)}"`).join(", ");
		lines.push(`tags: [${tagsStr}]`);
	}
	if (data.category) lines.push(`category: "${escapeYaml(data.category)}"`);
	if (data.lang) lines.push(`lang: "${escapeYaml(data.lang)}"`);
	if (data.author) lines.push(`author: "${escapeYaml(data.author)}"`);
	if (data.licenseName)
		lines.push(`licenseName: "${escapeYaml(data.licenseName)}"`);
	if (data.licenseUrl)
		lines.push(`licenseUrl: "${escapeYaml(data.licenseUrl)}"`);
	if (data.sourceLink)
		lines.push(`sourceLink: "${escapeYaml(data.sourceLink)}"`);
	if (data.draft !== undefined) lines.push(`draft: ${data.draft}`);
	lines.push(`pinned: ${data.pinned ?? false}`);
	if (data.comment !== undefined) lines.push(`comment: ${data.comment}`);
	if (data.password) lines.push(`password: "${escapeYaml(data.password)}"`);
	if (data.passwordHint)
		lines.push(`passwordHint: "${escapeYaml(data.passwordHint)}"`);

	return lines.join("\n");
}

function escapeYaml(str: string): string {
	return str.replace(/"/g, '\\"');
}
