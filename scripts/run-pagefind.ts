// 在 astro build 之后运行 Pagefind。
// 直接写 `pagefind --site dist` 时，Cloudflare/Vercel 产物在子目录（dist/client、
// .vercel/output/static），会索引出带前缀的假路径，且索引输出到 dist/pagefind，
// 不会随站点部署。这里先解析真实站点根目录再跑，索引输出到 <root>/pagefind。

import { spawnSync } from "node:child_process";
import { resolveSiteRoot } from "./site-root";

const siteRoot = resolveSiteRoot();

const result = spawnSync("pagefind", ["--site", siteRoot], {
	stdio: "inherit",
	// Windows 下 .bin 里是 .cmd 包装，需要 shell 才能解析到
	shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
