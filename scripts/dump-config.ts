// 由后台配置 API 通过 tsx 执行：读取指定配置文件并输出其 JSON 内容
// 用法: npx tsx scripts/dump-config.ts <key>
// 说明：配置文件是 TS 源文件，无法直接 JSON 化，因此用 tsx 解析后求值，
//       每次调用都会重新读取磁盘上的最新内容，保证"在线编辑"立即生效。
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_ITEMS, getConfigItem } from "../src/utils/admin-settings";

const key = process.argv[2];

const item = getConfigItem(key);
if (!item) {
	console.error(
		`[DumpConfig] 未知配置项: ${key}（可选: ${CONFIG_ITEMS.map((i) => i.key).join(", ")}）`,
	);
	process.exit(1);
}

const fileUrl = pathToFileURL(path.resolve(process.cwd(), item.file)).href;
const mod = (await import(fileUrl)) as Record<string, unknown>;
const value = mod[item.exportName];
if (value === undefined) {
	console.error(`[DumpConfig] 配置模块未导出 ${item.exportName}`);
	process.exit(1);
}

process.stdout.write(JSON.stringify(value));
