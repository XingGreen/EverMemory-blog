import { getCollection } from "astro:content";

import { requireAuth } from "@/utils/auth";
import {
	normalizeName,
	readPostFile,
	readRegistry,
	rewriteFrontmatter,
	type TaxonomyKind,
	type TaxonomyRegistry,
	writePostFile,
	writeRegistry,
} from "@/utils/taxonomy";

export const prerender = false;

export type TaxonomyEntry = {
	name: string;
	kind: TaxonomyKind;
	/** 引用该分类/标签的文章总数（对齐参考项目 postCount） */
	count: number;
	/** 其中已发布的数量（对齐参考项目 publicPostCount；草稿不计入） */
	publishedCount: number;
	/** 是否为「未分类」占位项 */
	uncategorized?: boolean;
};

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** 聚合：文章实际引用 ∪ 登记表里显式登记的名字 */
async function collect(): Promise<{
	entries: TaxonomyEntry[];
	uncategorizedCount: number;
	uncategorizedPublishedCount: number;
	slugsByCategory: Map<string, string[]>;
	slugsByTag: Map<string, string[]>;
}> {
	const posts = await getCollection("posts");
	const registry = await readRegistry();

	const catMap = new Map<string, { total: number; published: number }>();
	const tagMap = new Map<string, { total: number; published: number }>();
	const slugsByCategory = new Map<string, string[]>();
	const slugsByTag = new Map<string, string[]>();
	let uncategorizedCount = 0;
	let uncategorizedPublishedCount = 0;

	for (const post of posts) {
		// 对齐参考项目 postCount / publicPostCount：
		// total = 全部文章数；published = 其中的已发布数（草稿不算）
		const isPublished = post.data.draft !== true;
		const rawCat =
			typeof post.data.category === "string" ? post.data.category.trim() : "";
		if (rawCat) {
			const cur = catMap.get(rawCat) ?? { total: 0, published: 0 };
			cur.total += 1;
			if (isPublished) cur.published += 1;
			catMap.set(rawCat, cur);
			const list = slugsByCategory.get(rawCat) ?? [];
			list.push(post.id);
			slugsByCategory.set(rawCat, list);
		} else {
			uncategorizedCount += 1;
			if (isPublished) uncategorizedPublishedCount += 1;
		}

		for (const rawTag of post.data.tags ?? []) {
			const tag = String(rawTag).trim();
			if (!tag) continue;
			const cur = tagMap.get(tag) ?? { total: 0, published: 0 };
			cur.total += 1;
			if (isPublished) cur.published += 1;
			tagMap.set(tag, cur);
			const list = slugsByTag.get(tag) ?? [];
			list.push(post.id);
			slugsByTag.set(tag, list);
		}
	}

	// 登记表里的空项补 0 计数
	for (const name of registry.categories) {
		if (!catMap.has(name)) catMap.set(name, { total: 0, published: 0 });
	}
	for (const name of registry.tags) {
		if (!tagMap.has(name)) tagMap.set(name, { total: 0, published: 0 });
	}

	const sortFn = (a: TaxonomyEntry, b: TaxonomyEntry) =>
		b.count - a.count ||
		a.name.toLowerCase().localeCompare(b.name.toLowerCase());

	const entries: TaxonomyEntry[] = [
		...[...catMap.entries()].map(([name, v]) => ({
			name,
			kind: "category" as const,
			count: v.total,
			publishedCount: v.published,
		})),
		...[...tagMap.entries()].map(([name, v]) => ({
			name,
			kind: "tag" as const,
			count: v.total,
			publishedCount: v.published,
		})),
	].sort(sortFn);

	return {
		entries,
		uncategorizedCount,
		uncategorizedPublishedCount,
		slugsByCategory,
		slugsByTag,
	};
}

/** GET /api/admin/taxonomy/ —— 返回分类与标签聚合结果 */
export async function GET({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	/* 分类/标签是随时会被改的数据，不能进浏览器缓存 */
	const noStore = { "Cache-Control": "no-store, must-revalidate" };

	try {
		const { entries, uncategorizedCount, uncategorizedPublishedCount } =
			await collect();
		return json({
			success: true,
			entries,
			uncategorizedCount,
			uncategorizedPublishedCount,
		});
	} catch (error) {
		console.error("[Admin Taxonomy] GET failed:", error);
		return json({ success: false, message: "获取分类/标签失败" }, 500);
	}
} /**
 * 批量改写引用某分类/标签的所有文章。
 *
 * 两阶段提交：先把所有受影响文章读入内存并算好新内容，
 * 全部成功后才统一写盘。任一环节失败就整体放弃，避免
 * 「部分文章改了、部分没改」导致同一分类/标签数据分叉
 * （实测踩过：guide/index.md 与 mdx-example.mdx 因路径探测
 * 失败而未更新，结果旧名与新名同时存在于聚合结果里）。
 */
async function rewriteAll(
	kind: TaxonomyKind,
	from: string,
	to: string | null,
	message: string,
): Promise<{ updated: number; failed: string[]; aborted: boolean }> {
	const posts = await getCollection("posts");
	const pending: { slug: string; content: string }[] = [];
	const failed: string[] = [];

	// 阶段一：全部读取 + 计算新内容，不写盘
	for (const post of posts) {
		const raw =
			kind === "category"
				? typeof post.data.category === "string"
					? post.data.category.trim()
					: ""
				: "";
		const inTags =
			kind === "tag"
				? (post.data.tags ?? []).some((t) => String(t).trim() === from)
				: false;

		const touches = kind === "category" ? raw === from : inTags;
		if (!touches) continue;

		const content = await readPostFile(post.id);
		if (!content) {
			failed.push(post.id);
			continue;
		}
		const next = rewriteFrontmatter(content, kind, from, to);
		if (!next) continue;
		pending.push({ slug: post.id, content: next });
	}

	// 有任何一篇读不到 → 整体放弃，不写任何文件
	if (failed.length > 0) {
		return { updated: 0, failed, aborted: true };
	}

	// 阶段二：统一写盘
	let updated = 0;
	for (const item of pending) {
		const ok = await writePostFile(item.slug, item.content, message);
		if (ok) updated += 1;
		else failed.push(item.slug);
	}

	return { updated, failed, aborted: false };
}

/**
 * POST /api/admin/taxonomy/
 * body: { action: "create" | "rename" | "delete", kind, name, newName? }
 */
export async function POST({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let body: {
		action?: string;
		kind?: string;
		name?: string;
		newName?: string;
	};
	try {
		body = await request.json();
	} catch {
		return json({ success: false, message: "请求体不是合法 JSON" }, 400);
	}

	const { action, kind } = body;
	if (kind !== "category" && kind !== "tag") {
		return json(
			{ success: false, message: "kind 必须是 category 或 tag" },
			400,
		);
	}
	if (!["create", "rename", "delete"].includes(action ?? "")) {
		return json({ success: false, message: "action 无效" }, 400);
	}

	const registry = await readRegistry();
	const listKey = kind === "category" ? "categories" : "tags";
	const list = registry[listKey];

	if (action === "create") {
		const name = normalizeName(body.name);
		if (!name) return json({ success: false, message: "名称不能为空" }, 400);
		const { entries } = await collect();
		if (entries.some((e) => e.kind === kind && e.name === name)) {
			return json({ success: false, message: "同名项已存在" }, 409);
		}
		list.push(name);
		await writeRegistry(registry);
		return json({ success: true, message: "已创建" });
	}

	const from = normalizeName(body.name);
	if (!from) return json({ success: false, message: "名称不能为空" }, 400);

	if (action === "rename") {
		const to = normalizeName(body.newName);
		if (!to) return json({ success: false, message: "新名称不能为空" }, 400);
		if (to === from) return json({ success: true, message: "名称未变" });

		const { entries } = await collect();
		if (entries.some((e) => e.kind === kind && e.name === to)) {
			return json({ success: false, message: "目标名称已存在" }, 409);
		}

		const { updated, failed, aborted } = await rewriteAll(
			kind,
			from,
			to,
			`chore(taxonomy): 重命名${kind === "category" ? "分类" : "标签"} ${from} → ${to}`,
		);
		if (aborted) {
			return json(
				{
					success: false,
					message: `有 ${failed.length} 篇文章读取失败，已放弃本次操作（未修改任何文件）`,
					failed,
				},
				500,
			);
		}
		// 登记表同步：替换旧名，或把新名登记进去（原本只在文章里存在时）
		const idx = list.indexOf(from);
		if (idx >= 0) list[idx] = to;
		else if (!list.includes(to)) list.push(to);
		await writeRegistry(registry);

		return json({
			success: true,
			message: `已重命名，更新 ${updated} 篇文章`,
			updated,
			failed,
		});
	}

	// delete：清空所有引用（分类置空、标签移除），并从登记表移除
	const { updated, failed, aborted } = await rewriteAll(
		kind,
		from,
		null,
		`chore(taxonomy): 删除${kind === "category" ? "分类" : "标签"} ${from}`,
	);
	if (aborted) {
		return json(
			{
				success: false,
				message: `有 ${failed.length} 篇文章读取失败，已放弃本次操作（未修改任何文件）`,
				failed,
			},
			500,
		);
	}
	const idx = list.indexOf(from);
	/* 登记表里没有这一项时，之前的实现会跳过 splice 却照旧返回成功，
	   前端因此提示「已删除」但列表纹丝不动。 */
	if (idx < 0) {
		return json(
			{
				success: false,
				/* 结构化原因：前端据此区分「操作失败」与「早就不存在了」 */
				code: "NOT_FOUND",
				message: `登记表里找不到「${from}」，可能已被删除或名称不一致`,
			},
			409,
		);
	}
	list.splice(idx, 1);
	await writeRegistry(registry);

	/* 有文章清理失败也要如实说：登记表已移除，但正文里的引用还在 */
	if (failed.length > 0) {
		return json(
			{
				success: false,
				message: `已从登记表移除，但有 ${failed.length} 篇文章清理失败：${failed.join(", ")}`,
				updated,
				failed,
			},
			500,
		);
	}

	return json({
		success: true,
		message: `已删除，更新 ${updated} 篇文章`,
		updated,
		failed,
	});
}

/** 供其它模块复用的类型导出 */
export type { TaxonomyRegistry };
