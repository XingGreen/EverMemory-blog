import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { IS_PROD_BUILD } from "@/utils/env";
import {
	isValidPostSlug,
	resolvePostPath,
	saveFileLocally,
	saveFileToGitHub,
} from "@/utils/github-app";

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

		/* 0. 保存前快照旧版本——历史版本功能的数据来源。
		      只在开发构建（本地可写）下做：生产目录只读，写不进磁盘；
		      内容没变也不产生版本，避免重复保存堆出一串空记录。 */
		if (!IS_PROD_BUILD) {
			try {
				const absPath = path.resolve(process.cwd(), filePath);
				if (existsSync(absPath)) {
					const previous = readFileSync(absPath, "utf-8");
					if (previous !== fullContent) {
						const dir = path.resolve(
							process.cwd(),
							`src/content/.revisions/${slug}`,
						);
						mkdirSync(dir, { recursive: true });
						writeFileSync(
							path.join(dir, `${Date.now()}-auto.md`),
							previous,
							"utf-8",
						);
					}
				}
			} catch {
				// 快照失败不影响正常保存
			}
		}

		const commitMessage = `update post: ${title || slug} via admin dashboard`;

		/* 1. 本地文件系统只在开发构建下可写：Vercel / Cloudflare Workers 的项目
		      目录只读，写必然失败。旧代码靠 saveFileLocally 内部的 try/catch
		      吞掉异常，功能上没错，但每次保存都白跑一次 mkdir + writeFile，
		      而且「本地失败」会混进下面的成功判定里。语义与 secret-io 的
		      isEnvFileWritable 保持一致：生产即只读。 */
		const localSuccess = IS_PROD_BUILD
			? false
			: saveFileLocally(filePath, fullContent);

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
					/* 两条通道分开回传：生产环境 local 恒为 false，调用方据此
					   区分「已同步」与「仅本地」，不必去解析 message 文案 */
					local: localSuccess,
					remote: githubSuccess,
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
				local: false,
				remote: false,
				message: "保存失败（本地和 GitHub 均失败）",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
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
