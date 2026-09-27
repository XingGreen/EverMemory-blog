// 构建时生成后台配置快照模块（Serverless 环境可视化表单用）
// 用法: npx tsx scripts/generate-config-snapshot.ts
// 说明：Serverless（Vercel/Cloudflare）没有本地 TS 源码，也无法运行 tsx
//       子进程求值配置。构建阶段把每个配置项求值为 JSON 快照 + 读取源码原文，
//       随函数打包 / 注入后台页面 HTML，前端直接读取（免 API），
//       保存时以 GitHub 源码为基底提交（触发自动重建后生效）。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_ITEMS } from "../src/utils/admin-settings";

const OUT = path.resolve(process.cwd(), "src/constants/admin-config-snapshot.ts");

type SnapshotEntry = { data?: unknown; source: string };
const snapshot: Record<string, SnapshotEntry> = {};
let failed = 0;

for (const item of CONFIG_ITEMS) {
	const filePath = path.resolve(process.cwd(), item.file);
	let source = "";
	try {
		source = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		failed++;
		console.error(
			`[ConfigSnapshot] ${item.key} 读取源码失败（${item.file}）: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		continue;
	}

	if (item.kind === "html") {
		snapshot[item.key] = { source };
		console.log(`[ConfigSnapshot] ${item.key} <- ${item.file} (html) OK`);
		continue;
	}

	try {
		const fileUrl = pathToFileURL(filePath).href;
		// 加 query 破模块缓存，确保读取磁盘上的最新内容
		const mod = await import(`${fileUrl}?t=${Date.now()}+${Math.random()}`);
		// 友链配置包含页面配置 + 友链条目两个导出，合并为复合快照
		const data =
			item.key === "friends"
				? { page: mod["friendsPageConfig"], links: mod["friendsConfig"] }
				: mod[item.exportName];
		snapshot[item.key] = { data, source };
		console.log(`[ConfigSnapshot] ${item.key} <- ${item.file} OK`);
	} catch (error) {
		failed++;
		console.error(
			`[ConfigSnapshot] ${item.key} 求值失败（${item.file}）: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

const content =
	'// 由 scripts/generate-config-snapshot.ts 自动生成（构建时），请勿手动修改\n' +
	"// 用途：后台配置页面读取的配置快照（data=求值结果、source=源码原文）\n" +
	`export const ADMIN_CONFIG_SNAPSHOT: Record<string, unknown> = ${JSON.stringify(
		snapshot,
		null,
		"\t",
	)};\n`;

fs.writeFileSync(OUT, content, "utf8");
console.log(
	`[ConfigSnapshot] 已生成 ${OUT}（${Object.keys(snapshot).length} 项${
		failed ? `，失败 ${failed} 项` : ""
	}）`,
);
if (failed > 0) process.exitCode = 1;