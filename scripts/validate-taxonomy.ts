/**
 * 分类 / 标签一致性校验。
 *
 * 背景：本项目的分类和标签以文章 frontmatter 为准，`src/content/taxonomy.json`
 * 只做「补充登记」（用于承载没有任何文章引用的空分类/空标签，以及改名后的清单）。
 * 这带来一个真实风险：直接在 frontmatter 里手写名字时，很容易写出大小写不同、
 * 多一个空格、全角半角混用的变体，于是同一个标签被拆成两个。
 *
 * 本脚本做三件事：
 *   1. 汇总所有文章实际使用的分类/标签及计数（--sync 时把它们补登记进 registry）
 *   2. 报告「用了但没登记」的项（信息级，不阻断构建）
 *   3. 报告「归一化后相同」的疑似重复项（大小写/全半角/空白差异），这一项是真问题
 *
 * 用法：
 *   tsx scripts/validate-taxonomy.ts            # 只报告
 *   tsx scripts/validate-taxonomy.ts --sync     # 顺带补登记
 *   tsx scripts/validate-taxonomy.ts --strict   # 有未登记/重复项时以非零码退出
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const POSTS_DIR = join(ROOT, "src/content/posts");
const REGISTRY_PATH = join(ROOT, "src/content/taxonomy.json");

const args = new Set(process.argv.slice(2));
const SYNC = args.has("--sync");
const STRICT = args.has("--strict");

/** registry 里的分类/标签，用于「是否已登记」的判断 */
type Registry = { categories: string[]; tags: string[] };

function readRegistry(): Registry {
	try {
		const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Partial<Registry>;
		return {
			categories: Array.isArray(raw.categories) ? raw.categories : [],
			tags: Array.isArray(raw.tags) ? raw.tags : [],
		};
	} catch {
		return { categories: [], tags: [] };
	}
}

/** 递归列出所有 markdown */
function listMarkdown(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) out.push(...listMarkdown(p));
		else if (name.endsWith(".md") || name.endsWith(".mdx")) out.push(p);
	}
	return out;
}

/** 取 frontmatter 原文（不含分隔行） */
function frontmatterOf(file: string): string {
	const text = readFileSync(file, "utf-8");
	if (!text.startsWith("---")) return "";
	const end = text.indexOf("\n---", 3);
	return end < 0 ? "" : text.slice(3, end);
}

/** 去掉包裹的引号 */
function unquote(v: string): string {
	const t = v.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	return t;
}

/**
 * 解析 `key:` 字段。
 * 支持三种写法：行内数组 `[a, b]`、多行数组（后续 `- a`）、标量。
 */
function parseField(fm: string, key: string): string[] {
	const lines = fm.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(new RegExp(`^${key}\\s*:\\s*(.*)$`));
		if (!m) continue;
		const inline = m[1].trim();

		if (inline.startsWith("[")) {
			// 行内数组：可能跨行，简单拼到出现 ] 为止
			let buf = inline;
			let j = i;
			while (!buf.includes("]") && j + 1 < lines.length) buf += " " + lines[++j].trim();
			const inner = buf.slice(buf.indexOf("[") + 1, buf.lastIndexOf("]"));
			return inner
				.split(",")
				.map((s) => unquote(s))
				.filter(Boolean);
		}
		if (inline === "") {
			// 多行数组
			const out: string[] = [];
			for (let j = i + 1; j < lines.length; j++) {
				const item = lines[j].match(/^\s*-\s*(.+)$/);
				if (!item) break;
				out.push(unquote(item[1]));
			}
			return out.filter(Boolean);
		}
		// 标量
		return [unquote(inline)].filter(Boolean);
	}
	return [];
}

/** 归一化：去空白 + 全角转半角 + 小写，仅用于「疑似重复」判定 */
function normalize(name: string): string {
	return name
		.trim()
		.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
		.replace(/\s+/g, " ")
		.toLowerCase();
}

function main(): void {
	let files: string[];
	try {
		files = listMarkdown(POSTS_DIR);
	} catch {
		console.error(`[taxonomy] 找不到文章目录：${POSTS_DIR}`);
		process.exit(1);
	}

	const categoryCount = new Map<string, number>();
	const tagCount = new Map<string, number>();

	for (const file of files) {
		const fm = frontmatterOf(file);
		if (!fm) continue;
		for (const c of parseField(fm, "category")) {
			categoryCount.set(c, (categoryCount.get(c) ?? 0) + 1);
		}
		for (const t of parseField(fm, "tags")) {
			tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
		}
	}

	const registry = readRegistry();
	const problems: string[] = [];
	const unregistered: { kind: string; name: string }[] = [];

	const check = (kind: "category" | "tag", counts: Map<string, number>, registered: string[]) => {
		const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		const known = new Set(registered.map((n) => normalize(n)));

		// 未登记
		for (const [name] of list) {
			if (!known.has(normalize(name))) unregistered.push({ kind, name });
		}

		// 疑似重复：归一化后相同但原文不同
		const buckets = new Map<string, string[]>();
		for (const [name] of list) {
			const k = normalize(name);
			buckets.set(k, [...(buckets.get(k) ?? []), name]);
		}
		for (const [, names] of buckets) {
			if (names.length > 1) {
				problems.push(
					`${kind === "category" ? "分类" : "标签"}疑似重复：${names.map((n) => `「${n}」`).join(" / ")}（归一化后相同，应合并为同一个）`,
				);
			}
		}

		// 登记了但没有任何文章使用（空分类，属正常，仅提示）
		const unused = registered.filter((n) => !list.some(([name]) => normalize(name) === normalize(n)));
		if (unused.length > 0) {
			console.log(
				`[taxonomy] ${kind === "category" ? "分类" : "标签"}登记表里 ${unused.length} 项暂无文章引用（允许）：${unused.join("、")}`,
			);
		}
	};

	check("category", categoryCount, registry.categories);
	check("tag", tagCount, registry.tags);

	console.log(`[taxonomy] 扫描 ${files.length} 篇文章`);
	console.log(
		`[taxonomy] 分类 ${categoryCount.size} 个、标签 ${tagCount.size} 个（仅统计 frontmatter 里实际出现的）`,
	);

	if (unregistered.length > 0) {
		const byKind = (k: string) => unregistered.filter((u) => u.kind === k).map((u) => `「${u.name}」`);
		console.log("\n[taxonomy] 以下项出现在 frontmatter 但未登记（--sync 可自动补登记）：");
		if (byKind("category").length) console.log(`  分类：${byKind("category").join("、")}`);
		if (byKind("tag").length) console.log(`  标签：${byKind("tag").join("、")}`);
	}

	if (problems.length > 0) {
		console.log("\n[taxonomy] ⚠ 发现问题：");
		for (const p of problems) console.log(`  - ${p}`);
	}

	if (SYNC && unregistered.length > 0) {
		for (const u of unregistered) {
			if (u.kind === "category" && !registry.categories.includes(u.name)) {
				registry.categories.push(u.name);
			}
			if (u.kind === "tag" && !registry.tags.includes(u.name)) {
				registry.tags.push(u.name);
			}
		}
		registry.categories.sort();
		registry.tags.sort();
		writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, "\t")}\n`, "utf-8");
		console.log(
			`\n[taxonomy] 已补登记 ${unregistered.length} 项到 src/content/taxonomy.json`,
		);
	}

	if (problems.length === 0 && unregistered.length === 0) {
		console.log("[taxonomy] ✓ 分类与标签一致，无重复、全部已登记");
	}

	if (STRICT && (problems.length > 0 || unregistered.length > 0)) {
		process.exit(1);
	}
}

main();
