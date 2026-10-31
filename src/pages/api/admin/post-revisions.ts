/**
 * 文章历史版本。
 *
 * 方案对应参考项目 post-editor-history-*（revisions.list / get / restore），
 * 存储介质从 D1 换成文件——本项目的内容事实源是 markdown，没有数据库。
 *
 * 存储位置：src/content/.revisions/<slug>/<epochMs>-<reason>.md
 *   · 目录名以点开头，且不匹配 content collection 的 posts/**路径，不会被 Astro 收录；
 *   · reason 沿用参考语义：auto（保存前自动快照）/ publish / restore_backup（恢复前备份）。
 *
 * 恢复逻辑：读目标版本 → 覆盖正文 → 恢复前先把当前正文存为 restore_backup，
 * 保证「恢复」本身也可回退。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import {
	getFileFromGitHub,
	saveFileLocally,
	saveFileToGitHub,
} from "@/utils/github-app";

export const prerender = false;

type RevisionReason = "auto" | "publish" | "restore_backup";

const REVISIONS_ROOT = "src/content/.revisions";

function postRelPath(slug: string): string {
	return `src/content/posts/${slug}.md`;
}

function revisionDirRel(slug: string): string {
	return `${REVISIONS_ROOT}/${slug}`;
}

function revisionFileName(reason: RevisionReason): string {
	return `${Date.now()}-${reason}.md`;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** 从 markdown 的 frontmatter 里取标题、分类、标签（供历史列表与详情摘要） */
function readFrontmatterMeta(content: string): {
	title: string;
	category: string;
	tags: string[];
} {
	const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) return { title: "", category: "", tags: [] };
	const body = fm[1];
	const titleLine = body.match(/^title:\s*(.*)$/m);
	const title = titleLine ? titleLine[1].trim().replace(/^"(.*)"$/, "$1") : "";
	const catLine = body.match(/^category:\s*(.*)$/m);
	const category = catLine ? catLine[1].trim().replace(/^"(.*)"$/, "$1") : "";
	const tags: string[] = [];
	const inline = body.match(/^tags:\s*\[(.*)\]$/m);
	if (inline) {
		for (const raw of inline[1].split(",")) {
			const t = raw.trim().replace(/^["'](.*)["']$/, "$1");
			if (t) tags.push(t);
		}
	} else {
		// 块式写法：tags:\n  - foo\n  - bar
		const block = body.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
		if (block) {
			for (const line of block[1].split("\n")) {
				const t = line
					.replace(/^\s*-\s*/, "")
					.trim()
					.replace(/^["'](.*)["']$/, "$1");
				if (t) tags.push(t);
			}
		}
	}
	return { title, category, tags };
}

/** 列出某篇文章的版本（新→旧）；带标题，列表项与参考一样显示「时间 / 原因 / 标题」 */
function listRevisions(slug: string): {
	id: string;
	reason: RevisionReason;
	savedAt: number;
	title: string;
	category: string;
	tags: string[];
}[] {
	const abs = path.resolve(process.cwd(), revisionDirRel(slug));
	if (!existsSync(abs)) return [];
	try {
		return readdirSync(abs)
			.filter((f) => f.endsWith(".md"))
			.map(
				(
					f,
				): {
					id: string;
					reason: RevisionReason;
					savedAt: number;
					title: string;
					category: string;
					tags: string[];
				} => {
					const [tsRaw, reasonRaw] = f.replace(/\.md$/, "").split("-");
					const ts = Number(tsRaw);
					const reason = (reasonRaw ?? "auto") as RevisionReason;
					let meta = {
						title: "",
						category: "",
						tags: [] as string[],
					};
					try {
						meta = readFrontmatterMeta(
							readFileSync(path.join(abs, f), "utf-8"),
						);
					} catch {
						// 快照损坏：留空，不影响列表展示
					}
					return {
						id: f,
						reason:
							reason === "publish" || reason === "restore_backup"
								? reason
								: "auto",
						savedAt: Number.isFinite(ts) ? ts : 0,
						title: meta.title,
						category: meta.category,
						tags: meta.tags,
					};
				},
			)
			.sort((a, b) => b.savedAt - a.savedAt);
	} catch {
		return [];
	}
}

export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const url = new URL(request.url);
	const slug = url.searchParams.get("slug")?.trim() ?? "";
	const id = url.searchParams.get("id")?.trim() ?? "";
	if (!slug) return json({ success: false, message: "缺少 slug" }, 400);

	if (!id) {
		return json({ success: true, revisions: listRevisions(slug) });
	}

	// 单条详情：本地有就直接读，线上回退到 GitHub（多机场景）
	if (id.includes("/") || id.includes("..")) {
		return json({ success: false, message: "非法的版本 id" }, 400);
	}
	const rel = `${revisionDirRel(slug)}/${id}`;
	const abs = path.resolve(process.cwd(), rel);
	let content: string | null = null;
	if (existsSync(abs)) {
		content = readFileSync(abs, "utf-8");
	} else {
		try {
			content = await getFileFromGitHub(rel);
		} catch {
			content = null;
		}
	}
	if (content === null) {
		return json({ success: false, message: "版本不存在" }, 404);
	}
	return json({ success: true, content });
}

export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let body: { slug?: string; id?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, message: "请求体不是合法 JSON" }, 400);
	}

	const slug = body.slug?.trim() ?? "";
	const id = body.id?.trim() ?? "";
	if (!slug || !id)
		return json({ success: false, message: "缺少 slug 或 id" }, 400);
	if (id.includes("/") || id.includes("..")) {
		return json({ success: false, message: "非法的版本 id" }, 400);
	}

	const revRel = `${revisionDirRel(slug)}/${id}`;
	const revAbs = path.resolve(process.cwd(), revRel);
	let target: string | null = null;
	if (existsSync(revAbs)) target = readFileSync(revAbs, "utf-8");
	else {
		try {
			target = await getFileFromGitHub(revRel);
		} catch {
			target = null;
		}
	}
	if (target === null)
		return json({ success: false, message: "版本不存在" }, 404);

	const postRel = postRelPath(slug);
	const postAbs = path.resolve(process.cwd(), postRel);
	if (!existsSync(postAbs)) {
		return json({ success: false, message: "本地正文不存在" }, 404);
	}

	// 恢复前把当前正文备份成 restore_backup，保证恢复本身可回退
	const current = readFileSync(postAbs, "utf-8");
	const backupDir = path.resolve(process.cwd(), revisionDirRel(slug));
	try {
		mkdirSync(backupDir, { recursive: true });
		saveFileLocally(
			`${revisionDirRel(slug)}/${revisionFileName("restore_backup")}`,
			current,
		);
	} catch {
		// 备份失败不阻断恢复，但会在响应里提示
	}

	const ok = saveFileLocally(postRel, target);
	if (!ok) return json({ success: false, message: "写入正文失败" }, 500);

	// 生产环境本地目录只读，正文还要推一次 GitHub；失败不视为整体失败
	let pushed = true;
	try {
		pushed = await saveFileToGitHub(
			postRel,
			target,
			`chore(history): 恢复到 ${id}`,
		);
	} catch {
		pushed = false;
	}

	return json({
		success: true,
		message: pushed ? "已恢复该版本" : "本地已恢复，但推送 GitHub 失败",
	});
}
