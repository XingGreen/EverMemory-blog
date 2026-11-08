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

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { saveFileLocally } from "@/utils/github-app";
import { getStorageProvider } from "@/utils/providers/registry";
import { getStore } from "@/utils/persist-store";

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
	image: string;
	draft: boolean;
} {
	const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm)
		return { title: "", category: "", tags: [], image: "", draft: false };
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
	const imgLine = body.match(/^image:\s*(.*)$/m);
	const image = imgLine
		? imgLine[1].trim().replace(/^["'](.*)["']$/, "$1")
		: "";
	const draftLine = body.match(/^draft:\s*(.*)$/m);
	const draft = draftLine ? /^(true|yes)$/i.test(draftLine[1].trim()) : false;
	return { title, category, tags, image, draft };
}

/**
 * 列出某篇文章的版本（新→旧）。
 * 存储介质是 persist-store（KV / file / db 由后端选择），不再是本地目录——
 * 云端项目目录只读，写文件必然失败，历史版本在线上会是死的。
 * 键形如 rev:<slug>:<epochMs>，值 { content, reason, savedAt }；
 * 标题/分类/标签/草稿从 content 的 frontmatter 现场解析，与旧实现一致。
 */
async function listRevisions(slug: string): Promise<
	{
		id: string;
		reason: RevisionReason;
		savedAt: number;
		title: string;
		category: string;
		tags: string[];
		image: string;
		draft: boolean;
	}[]
> {
	const store = getStore();
	if (!store.list) return [];
	let keys: string[] = [];
	try {
		keys = await store.list(`rev:${slug}:`, 200);
	} catch {
		return [];
	}
	const items = await Promise.all(
		keys.map(async (key) => {
			const ts = Number(key.split(":").pop());
			let rec: { content?: string; reason?: string; savedAt?: number } | null =
				null;
			try {
				rec = await store.get(key);
			} catch {
				return null;
			}
			if (!rec || typeof rec.content !== "string") return null;
			let meta = {
				title: "",
				category: "",
				tags: [] as string[],
				image: "",
				draft: false,
			};
			try {
				meta = readFrontmatterMeta(rec.content);
			} catch {
				// 快照损坏：留空，不影响列表
			}
			const reason = rec.reason ?? "auto";
			return {
				id: String(ts),
				reason: (reason === "publish" || reason === "restore_backup"
					? reason
					: "auto") as RevisionReason,
				savedAt: Number.isFinite(rec.savedAt) ? (rec.savedAt as number) : ts,
				title: meta.title,
				category: meta.category,
				tags: meta.tags,
				image: meta.image,
				draft: meta.draft,
			};
		}),
	);
	return items
		.filter((x): x is NonNullable<typeof x> => x !== null)
		.sort((a, b) => b.savedAt - a.savedAt);
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
		return json({ success: true, revisions: await listRevisions(slug) });
	}

	// 单条详情：从 store 读（键 rev:<slug>:<ts>）
	if (id.includes("/") || id.includes("..")) {
		return json({ success: false, message: "非法的版本 id" }, 400);
	}
	let content: string | null = null;
	try {
		const rec = await getStore().get<{ content?: string }>(`rev:${slug}:${id}`);
		content = typeof rec?.content === "string" ? rec.content : null;
	} catch {
		content = null;
	}
	/* 回退：老快照是 .revisions 目录里的 <ts>-<reason>.md，
	   线上还从 GitHub 读过。这里保留这条路径，避免历史数据直接消失。 */
	if (content === null) {
		const rel = `${revisionDirRel(slug)}/${id}`;
		const abs = path.resolve(process.cwd(), rel);
		if (existsSync(abs)) {
			content = readFileSync(abs, "utf-8");
		} else {
			try {
				const read = await getStorageProvider().readFile(rel);
				content = read.ok ? read.content : null;
			} catch {
				content = null;
			}
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

	let body: { slug?: string; id?: string; action?: string };
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

	/* 删除单个版本：对应参考 revisions.remove({ revisionIds: [id] })。
	   返回 deletedIds，前端据此判断删掉的的是否为当前选中项。 */
	if (body.action === "delete") {
		/* 主路径：删 store 里的键（rev:<slug>:<ts>） */
		let removedStore = false;
		try {
			const key = `rev:${slug}:${id}`;
			const existed = await getStore().get(key);
			if (existed) {
				await getStore().del(key);
				removedStore = true;
			}
		} catch {
			removedStore = false;
		}

		/* 回退：老格式的 .revisions 文件与 GitHub 上的同路径文件 */
		const revRel = `${revisionDirRel(slug)}/${id}`;
		const revAbs = path.resolve(process.cwd(), revRel);
		let removedLocal = false;
		if (existsSync(revAbs)) {
			try {
				rmSync(revAbs, { force: true });
				removedLocal = true;
			} catch {
				// 只读文件系统：交给 GitHub 分支处理
			}
		}
		let removedRemote = false;
		try {
			await getStorageProvider().deleteFile(
				revRel,
				`chore(history): 删除历史版本 ${slug}/${id}`,
			);
			removedRemote = true;
		} catch {
			removedRemote = false;
		}
		if (!removedStore && !removedLocal && !removedRemote)
			return json({ success: false, message: "REVISION_NOT_FOUND" }, 404);
		return json({ success: true, deletedIds: [id] });
	}

	/* 目标版本：优先 store，回退老格式文件 / GitHub */
	let target: string | null = null;
	try {
		const rec = await getStore().get<{ content?: string }>(`rev:${slug}:${id}`);
		target = typeof rec?.content === "string" ? rec.content : null;
	} catch {
		target = null;
	}
	if (target === null) {
		const revRel = `${revisionDirRel(slug)}/${id}`;
		const revAbs = path.resolve(process.cwd(), revRel);
		if (existsSync(revAbs)) target = readFileSync(revAbs, "utf-8");
		else {
			try {
				const read = await getStorageProvider().readFile(revRel);
				target = read.ok ? read.content : null;
			} catch {
				target = null;
			}
		}
	}
	if (target === null)
		return json({ success: false, message: "版本不存在" }, 404);

	const postRel = postRelPath(slug);
	const postAbs = path.resolve(process.cwd(), postRel);
	/* 当前正文：本地可读就用本地，否则从 GitHub 取。
	   云端项目目录只读，existsSync 恒为 false，只认本地会直接 404。 */
	let current: string | null = null;
	if (existsSync(postAbs)) {
		current = readFileSync(postAbs, "utf-8");
	} else {
		try {
			const read = await getStorageProvider().readFile(postRel);
			current = read.ok ? read.content : null;
		} catch {
			current = null;
		}
	}
	if (current === null) {
		return json({ success: false, message: "当前正文不存在" }, 404);
	}

	// 恢复前把当前正文备份成 restore_backup，保证恢复本身可回退
	try {
		const backupAt = Date.now();
		await getStore().set(`rev:${slug}:${backupAt}`, {
			content: current,
			reason: "restore_backup",
			savedAt: backupAt,
		});
	} catch {
		// 备份失败不阻断恢复，但会在响应里提示
	}

	const ok = saveFileLocally(postRel, target);
	if (!ok) return json({ success: false, message: "写入正文失败" }, 500);

	// 生产环境本地目录只读，正文还要推一次 GitHub；失败不视为整体失败
	let pushed = true;
	try {
		pushed = await getStorageProvider().writeFile(
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
