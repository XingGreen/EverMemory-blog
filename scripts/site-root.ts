import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 构建产物根目录。
 *
 * 不同适配器输出位置不同：Cloudflare 输出到 `dist/client`，Vercel 输出到
 * `.vercel/output/static`，无适配器的 node 构建输出到 `dist`。取第一个包含
 * `_astro` 的目录，避免把索引或资源写到错误的层级。
 */
export function resolveSiteRoot(): string {
	for (const dir of ["dist/client", ".vercel/output/static", "dist"]) {
		if (existsSync(path.join(dir, "_astro"))) return dir;
	}
	return "dist";
}
