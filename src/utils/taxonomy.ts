/**
 * 分类 / 标签聚合与批量改写
 *
 * 本项目的分类与标签不是独立实体，而是散落在每篇文章 frontmatter 里的
 * 字符串（category）与字符串数组（tags）。因此「新建 / 重命名 / 删除」
 * 本质上都是对相关文章文件的批量改写：
 *   - 新建：仅登记一个名字（无文章引用时它不会出现在聚合结果里，
 *     所以需要一份「显式登记表」持久化空分类/空标签）
 *   - 重命名：把所有引用旧名的文章改为新名
 *   - 删除：把所有引用该名的文章清空该字段（分类置空、标签移除）
 *
 * 显式登记表存于 src/content/taxonomy.json，用于记录「还没有文章引用」
 * 的分类与标签，避免新建后立刻消失。聚合时与文章实际引用取并集。
 */
import fs from "node:fs";
import path from "node:path";

import { getStorageProvider } from "./providers/registry";
import { isEnvFileWritable } from "./secret-io";

export type TaxonomyKind = "category" | "tag";

/** 显式登记的空分类/空标签（尚未被任何文章引用） */
export type TaxonomyRegistry = {
	categories: string[];
	tags: string[];
};

const REGISTRY_PATH = "src/content/taxonomy.json";

function registryAbsPath(): string {
	return path.resolve(process.cwd(), REGISTRY_PATH);
}

/** 读取登记表；不存在或损坏时返回空表 */
export async function readRegistry(): Promise<TaxonomyRegistry> {
	const empty: TaxonomyRegistry = { categories: [], tags: [] };
	try {
		if (isEnvFileWritable()) {
			const p = registryAbsPath();
			if (!fs.existsSync(p)) return empty;
			const raw = fs.readFileSync(p, "utf-8");
			const data = JSON.parse(raw) as Partial<TaxonomyRegistry>;
			return {
				categories: Array.isArray(data.categories) ? data.categories : [],
				tags: Array.isArray(data.tags) ? data.tags : [],
			};
		}
		// 生产环境读远端存储
		const read = await getStorageProvider().readFile(REGISTRY_PATH);
		if (!read.ok) return empty;
		const data = JSON.parse(read.content) as Partial<TaxonomyRegistry>;
		return {
			categories: Array.isArray(data.categories) ? data.categories : [],
			tags: Array.isArray(data.tags) ? data.tags : [],
		};
	} catch {
		return empty;
	}
}

/** 写回登记表 */
export async function writeRegistry(registry: TaxonomyRegistry): Promise<void> {
	const content = `${JSON.stringify(registry, null, "\t")}\n`;
	if (isEnvFileWritable()) {
		const p = registryAbsPath();
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, content, "utf-8");
		return;
	}
	await getStorageProvider().writeFile(
		REGISTRY_PATH,
		content,
		"chore(taxonomy): 更新分类/标签登记表",
	);
}

/** 名称规范化：去首尾空白，拒绝空串 */
export function normalizeName(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	if (!trimmed) return null;
	// 换行会破坏 frontmatter，单双引号会干扰 YAML 解析
	if (/[\r\n]/.test(trimmed)) return null;
	return trimmed;
}

/** frontmatter 中 YAML 字符串是否需要加引号 */
function yamlQuote(value: string): string {
	// 含特殊字符时用双引号包裹并转义
	if (/[:#{}[\],&*?|<>=!%@`"']/.test(value) || /^\s|\s$/.test(value)) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

/**
 * 改写一篇文章的 frontmatter 中的 category / tags。
 *
 * 只处理 frontmatter 区域（首个 --- 与第二个 --- 之间），正文不动。
 * 返回改写后的完整文本；未发生变化时返回 null。
 */
export function rewriteFrontmatter(
	content: string,
	kind: TaxonomyKind,
	from: string,
	to: string | null,
): string | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;
	const fmRaw = match[1];
	const lines = fmRaw.split(/\r?\n/);
	let changed = false;

	if (kind === "category") {
		for (let i = 0; i < lines.length; i++) {
			const m = lines[i].match(/^(\s*category\s*:\s*)(.*)$/);
			if (!m) continue;
			const current = m[2].trim().replace(/^["']|["']$/g, "");
			if (current !== from) continue;
			lines[i] = to === null ? `${m[1]}""` : `${m[1]}${yamlQuote(to)}`;
			changed = true;
			break;
		}
	} else {
		for (let i = 0; i < lines.length; i++) {
			const m = lines[i].match(/^(\s*tags\s*:\s*)(.*)$/);
			if (!m) continue;
			const rest = m[2].trim();
			// 仅支持行内数组写法 tags: [a, b]
			if (!rest.startsWith("[")) break;
			const inner = rest.replace(/^\[/, "").replace(/\]$/, "");
			const items = inner
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
			const next = items
				.map((tag) => (tag === from ? to : tag))
				.filter((tag): tag is string => tag !== null && tag !== "");
			const deduped = [...new Set(next)];
			if (
				deduped.length === items.length &&
				items.every((t, idx) => t === deduped[idx])
			) {
				break;
			}
			lines[i] = `${m[1]}[${deduped.map(yamlQuote).join(", ")}]`;
			changed = true;
			break;
		}
	}

	if (!changed) return null;
	const newFm = lines.join("\n");
	return content.replace(match[0], `---\n${newFm}\n---`);
}

/**
 * 文章文件的相对路径解析已上移到 github-app 的 `resolvePostPath`：
 * save / delete / post-content 也要按同样的候选顺序探测真实扩展名，
 * 否则 .mdx 文章会被当成 .md 处理（编辑另存出重复文件、删除删不到）。
 */

/** 读取一篇文章的原始文本（本地或 GitHub） */
export async function readPostFile(slug: string): Promise<string | null> {
	const relPath = (await getStorageProvider().resolvePath?.(slug)) ?? null;
	if (!relPath) return null;
	try {
		if (isEnvFileWritable()) {
			return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
		}
		const read = await getStorageProvider().readFile(relPath);
		return read.ok ? read.content : null;
	} catch {
		return null;
	}
}

/** 写回一篇文章 */
export async function writePostFile(
	slug: string,
	content: string,
	message: string,
): Promise<boolean> {
	const relPath = (await getStorageProvider().resolvePath?.(slug)) ?? null;
	if (!relPath) return false;
	try {
		if (isEnvFileWritable()) {
			fs.writeFileSync(path.resolve(process.cwd(), relPath), content, "utf-8");
			return true;
		}
		await getStorageProvider().writeFile(relPath, content, message);
		return true;
	} catch {
		return false;
	}
}

/**
 * 批量写回文章（分类重命名 / 删除时会一次改动多篇）。
 *
 * 本地环境逐篇写盘即可；远端必须走一次 `commitFiles`——逐篇 `writeFile`
 * 在线上是「N 篇 = N 个 commit = N 次自动构建」，改一个分类名能把站点的
 * 构建队列堵满。`sync/apply` 早就是这个模式，这里对齐。
 */
export async function writePostFiles(
	items: Array<{ slug: string; content: string }>,
	message: string,
): Promise<{ updated: number; failed: string[] }> {
	const failed: string[] = [];
	if (items.length === 0) return { updated: 0, failed };

	if (isEnvFileWritable()) {
		let updated = 0;
		for (const item of items) {
			if (await writePostFile(item.slug, item.content, message)) updated += 1;
			else failed.push(item.slug);
		}
		return { updated, failed };
	}

	const storage = getStorageProvider();
	const changes: Array<{ slug: string; path: string; content: string }> = [];
	for (const item of items) {
		// 路径按真实扩展名探测：mdx 文章写成 .md 会另存出重复文件
		const relPath = (await storage.resolvePath?.(item.slug)) ?? null;
		if (!relPath) {
			failed.push(item.slug);
			continue;
		}
		changes.push({ slug: item.slug, path: relPath, content: item.content });
	}
	if (changes.length === 0) return { updated: 0, failed };

	const commit = await storage.commitFiles(
		changes.map(({ path, content }) => ({ path, content })),
		{ headline: message },
	);
	if (!commit.ok) {
		// 整批失败时不做部分成功判定：commit 是原子的，一个没进去就是全没进去
		return { updated: 0, failed: [...failed, ...changes.map((c) => c.slug)] };
	}
	return { updated: changes.length, failed };
}

/** 删除一篇文章文件（预留：批量清理场景） */ export async function deletePostFile(
	slug: string,
	message: string,
): Promise<boolean> {
	const relPath = `src/content/posts/${slug}.md`;
	try {
		if (isEnvFileWritable()) {
			const p = path.resolve(process.cwd(), relPath);
			if (fs.existsSync(p)) fs.unlinkSync(p);
			return true;
		}
		await getStorageProvider().deleteFile(relPath, message);
		return true;
	} catch {
		return false;
	}
}
