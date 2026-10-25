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

import {
	deleteFileFromGitHub,
	getFileFromGitHub,
	saveFileToGitHub,
} from "./github-app";
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
		// 生产环境读 GitHub
		const raw = await getFileFromGitHub(REGISTRY_PATH);
		if (!raw) return empty;
		const data = JSON.parse(raw) as Partial<TaxonomyRegistry>;
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
	await saveFileToGitHub(
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
 * 由 content collection 的 id 推出文章文件的相对路径。
 *
 * id 形态不止一种：
 *   - 平铺文件：demo            → src/content/posts/demo.md
 *   - 目录形式：guide/index     → src/content/posts/guide/index.md
 *   - mdx 扩展：mdx-example     → src/content/posts/mdx-example.mdx
 * 因此不能简单拼 `${id}.md`，必须按候选顺序探测真实文件。
 */
async function resolvePostPath(slug: string): Promise<string | null> {
	const candidates = [
		`src/content/posts/${slug}.md`,
		`src/content/posts/${slug}.mdx`,
		// id 是目录名时补 index 形式
		`src/content/posts/${slug}/index.md`,
		`src/content/posts/${slug}/index.mdx`,
	];

	if (isEnvFileWritable()) {
		for (const rel of candidates) {
			if (fs.existsSync(path.resolve(process.cwd(), rel))) return rel;
		}
		return null;
	}
	// 生产环境逐个问 GitHub，命中即返回
	for (const rel of candidates) {
		const raw = await getFileFromGitHub(rel);
		if (raw !== null) return rel;
	}
	return null;
}

/** 读取一篇文章的原始文本（本地或 GitHub） */
export async function readPostFile(slug: string): Promise<string | null> {
	const relPath = await resolvePostPath(slug);
	if (!relPath) return null;
	try {
		if (isEnvFileWritable()) {
			return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
		}
		return await getFileFromGitHub(relPath);
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
	const relPath = await resolvePostPath(slug);
	if (!relPath) return false;
	try {
		if (isEnvFileWritable()) {
			fs.writeFileSync(
				path.resolve(process.cwd(), relPath),
				content,
				"utf-8",
			);
			return true;
		}
		await saveFileToGitHub(relPath, content, message);
		return true;
	} catch {
		return false;
	}
}

/** 删除一篇文章文件（预留：批量清理场景） */
export async function deletePostFile(
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
		await deleteFileFromGitHub(relPath, message);
		return true;
	} catch {
		return false;
	}
}
