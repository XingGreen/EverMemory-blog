import fs from "node:fs";
import path from "node:path";
import { getCollection } from "astro:content";
import {
	extractAssetRefs,
	resolveAssetPath,
	toPackagePath,
} from "@/utils/export-paths";

/**
 * 导出包的数据收集。
 *
 * 这里只负责「把该带的东西读出来」，不负责打包与传输：
 * 打包在浏览器端做（utils/zip.ts），传输在这一层的调用方组装成 JSON。
 *
 * 为什么要带资源：现有导出只含正文，换台机器导入后 `![](images/x.avif)` 全是断链。
 * 所以这里沿着每篇文章正文里的引用，把 src/content 与 public 下的文件一起收进来。
 */

/** 单篇导出项：正文 + frontmatter */
export type ExportPost = {
	slug: string;
	filePath: string;
	content: string;
	frontmatter: Record<string, unknown>;
};

/** 一个静态资源：包内相对路径 + 原始字节（base64，便于走 JSON 传输） */
export type ExportAsset = {
	/** 包内路径，如 "assets/images/foo.avif" */
	path: string;
	/** 来源绝对路径（相对仓库根），用于导入时还原位置 */
	source: string;
	/** base64 编码的文件内容 */
	data: string;
	bytes: number;
};

export type ExportManifest = {
	version: 2;
	exportedAt: string;
	postCount: number;
	assetCount: number;
	/** 资源来源 → 包内路径 的映射，导入时据此还原 */
	assetMap: Record<string, string>;
};

export type ExportBundle = {
	manifest: ExportManifest;
	posts: ExportPost[];
	assets: ExportAsset[];
};

function repoRoot(): string {
	return process.cwd();
}

function toPosix(p: string): string {
	return p.replace(/\\/g, "/");
}

/**
 * 收集全部文章的正文、frontmatter 与引用到的资源。
 */
export async function collectPostAssets(): Promise<ExportBundle> {
	const root = repoRoot();
	const posts = await getCollection("posts");
	const collected: ExportPost[] = [];
	const assetMap: Record<string, string> = {};
	const assetSet = new Set<string>();

	const exists = (abs: string) => {
		try {
			return fs.existsSync(abs) && fs.statSync(abs).isFile();
		} catch {
			return false;
		}
	};

	for (const entry of posts) {
		const filePath = toPosix(entry.filePath ?? entry.id);
		const body = entry.body ?? "";
		const frontmatter = entry.data as Record<string, unknown>;

		collected.push({ slug: entry.id, filePath, content: body, frontmatter });

		for (const ref of extractAssetRefs(body)) {
			const resolved = resolveAssetPath(ref, filePath, root, exists);
			if (resolved) assetSet.add(resolved);
		}
		/* frontmatter 的 image 字段是封面配图，一并带上 */
		const cover = frontmatter.image;
		if (typeof cover === "string" && cover.trim()) {
			const resolved = resolveAssetPath(cover, filePath, root, exists);
			if (resolved) assetSet.add(resolved);
		}
	}

	const assets: ExportAsset[] = [];
	for (const source of assetSet) {
		const abs = path.join(root, source);
		const buf = fs.readFileSync(abs);
		const pkgPath = toPackagePath(source);
		assetMap[source] = pkgPath;
		assets.push({
			path: pkgPath,
			source,
			data: buf.toString("base64"),
			bytes: buf.length,
		});
	}

	return {
		manifest: {
			version: 2,
			exportedAt: new Date().toISOString(),
			postCount: collected.length,
			assetCount: assets.length,
			assetMap,
		},
		posts: collected,
		assets,
	};
}
