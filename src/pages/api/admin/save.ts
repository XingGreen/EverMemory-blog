import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { IS_PROD_BUILD } from "@/utils/env";
import {
	deleteFileLocally,
	isValidPostSlug,
	saveFileLocally,
} from "@/utils/github-app";
import { getStore } from "@/utils/persist-store";
import { deleteStoredDraft, putStoredDraft } from "@/utils/post-draft-store";
import { getStorageProvider } from "@/utils/providers/registry";

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
			/* 编辑页的原始 slug：与 slug 不同即为「改了标识」，需要清理旧文件 */
			originalSlug,
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
		const storage = getStorageProvider();
		const filePath =
			(await storage.resolvePath?.(slug)) ?? `src/content/posts/${slug}.md`;

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

		/* 同名拦截：新建（无 originalSlug）或改了标识时，目标文件必须不存在。
		   此前直接 writeFile，等于用新文章静默覆盖同名旧文章，
		   而旧文章的正文在覆盖瞬间就没了（历史快照也只能追溯）。 */
		const isRenaming =
			typeof originalSlug === "string" &&
			originalSlug !== "" &&
			originalSlug !== slug;
		if (!originalSlug || isRenaming) {
			let occupied = false;
			try {
				occupied = existsSync(path.resolve(process.cwd(), filePath));
			} catch {
				occupied = false;
			}
			if (!occupied) {
				try {
					const read = await storage.readFile(filePath);
					occupied = read.ok;
				} catch {
					occupied = false;
				}
			}
			if (occupied) {
				return new Response(
					JSON.stringify({
						success: false,
						code: "POST_EXISTS",
						message: isRenaming
							? `标识 ${slug} 已被占用，请换一个`
							: `已存在同名文章（${slug}），请修改标识后再保存`,
					}),
					{ status: 409, headers: { "Content-Type": "application/json" } },
				);
			}
		}

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
			/* 改了 slug：先写新文件、再删旧文件，顺序不能反——
			   先删后写的话，写失败就两头都没有。
			   远端不在这里删：保存只负责本地，远端留给同步面板处理。 */
			let renamedFrom: string | null = null;
			if (
				typeof originalSlug === "string" &&
				originalSlug &&
				originalSlug !== slug &&
				isValidPostSlug(originalSlug)
			) {
				const oldPath =
					(await storage.resolvePath?.(originalSlug)) ??
					`src/content/posts/${originalSlug}.md`;
				// 路径相同说明解析到了同一文件，不能删
				if (oldPath !== filePath) {
					try {
						if (deleteFileLocally(oldPath)) renamedFrom = originalSlug;
					} catch (err) {
						console.warn("[Admin Save] 清理旧 slug 文件失败:", err);
					}
				}
			}

			return new Response(
				JSON.stringify({
					success: true,
					local: true,
					remote: false,
					message: renamedFrom
						? `已保存为 ${slug}，旧文件 ${renamedFrom} 已移除（远端需在同步面板处理）`
						: "已保存到本地，推送请用同步面板",
					filePath,
					renamedFrom,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		/* 只读部署（Vercel / Workers）：项目目录不可写，草稿改存 KV。
		   草稿不参与构建，存 KV 既不会误发布，又能让线上把草稿写完；
		   正式文章仍不在线上保存——发布路径始终是同步面板。 */
		if (IS_PROD_BUILD && draft === true) {
			const stored = await putStoredDraft({
				slug,
				filePath,
				content: fullContent,
			});
			if (stored) {
				/* 草稿换了 slug：旧槽位要清掉，否则列表里会同时出现新旧两条 */
				if (
					typeof originalSlug === "string" &&
					originalSlug &&
					originalSlug !== slug &&
					isValidPostSlug(originalSlug)
				) {
					await deleteStoredDraft(originalSlug);
				}
				return new Response(
					JSON.stringify({
						success: true,
						local: false,
						remote: false,
						cloud: true,
						message: "草稿已保存到云端（当前部署只读，未写入仓库）",
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
					message: "草稿保存失败：云端存储不可用",
				}),
				{ status: 500, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				success: false,
				local: false,
				remote: false,
				message: IS_PROD_BUILD
					? "当前部署环境为只读，无法保存正式文章。可先存为草稿，或到本地编辑后从同步面板推送"
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
	if (data.published) lines.push(`published: ${safeScalar(data.published)}`);
	if (data.updated) lines.push(`updated: ${safeScalar(data.updated)}`);
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
	/* 布尔字段强制取真值：前端传 "false" 字符串时不该被写成布尔 true，
	   夹带换行的值也不该有机会往 frontmatter 里加行 */
	if (data.draft !== undefined) lines.push(`draft: ${data.draft === true}`);
	lines.push(`pinned: ${data.pinned === true}`);
	if (data.comment !== undefined) lines.push(`comment: ${data.comment}`);
	if (data.password) lines.push(`password: "${escapeYaml(data.password)}"`);
	if (data.passwordHint)
		lines.push(`passwordHint: "${escapeYaml(data.passwordHint)}"`);

	return lines.join("\n");
}

/** 裸标量（日期等）只允许单行：换行会往 frontmatter 里注入额外字段 */
function safeScalar(value: unknown): string {
	return String(value)
		.replace(/[\r\n]+/g, " ")
		.trim();
}

/**
 * 双引号 YAML 标量的转义。
 *
 * 反斜杠必须最先处理：在双引号标量里 `\U`、`\P` 都是非法转义，标题里写一个
 * Windows 路径（`C:\Users\...`）就会让整篇 frontmatter 解析失败，下一次
 * `astro build` 直接崩——而保存接口本身是成功的，问题要到构建时才暴露。
 * 换行与控制字符压成空格：否则 `published` 这类未转义的值可以带一个换行
 * 往 frontmatter 里注入任意字段。
 */
function escapeYaml(str: string): string {
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\p{Cc}+/gu, " ");
}
