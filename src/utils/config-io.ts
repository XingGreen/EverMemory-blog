// 配置文件的读取 / 序列化 / 写回（仅服务端使用，勿在前端组件中 import）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getConfigItem } from "./admin-settings";
import {
	collectComments,
	matchClosingBrace,
	serializeValue,
} from "./config-serializer";

const require = createRequire(import.meta.url);
// tsx 的 CLI 入口，用它来直接运行配置解析脚本（避免依赖 npx/PATH/网络）
const TSX_CLI = require.resolve("tsx/cli");

const projectRoot = process.cwd();

function loadItem(key: string) {
	const item = getConfigItem(key);
	if (!item) throw new Error(`未知配置项: ${key}`);
	return item;
}

/**
 * 读取原始文本配置（html 等非 TS 导出文件）
 */
function readRawConfigFile(item: ReturnType<typeof loadItem>): string {
	const filePath = path.resolve(projectRoot, item.file);
	if (!fs.existsSync(filePath))
		throw new Error(`配置文件不存在: ${item.file}`);
	return fs.readFileSync(filePath, "utf8");
}

/**
 * 读取配置文件的当前值（每次实时解析磁盘上的 TS 源文件；
 * html 类型直接返回文件原文）
 */
export function readConfigJson(key: string): { data: unknown; file: string } {
	const item = loadItem(key);
	if (item.kind === "html") {
		return { data: readRawConfigFile(item), file: item.file };
	}
	const script = path.resolve(projectRoot, "scripts/dump-config.ts");
	try {
		const out = execFileSync(process.execPath, [TSX_CLI, script, key], {
			cwd: projectRoot,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			timeout: 60_000,
		});
		// 防止 tsx 在 stdout 混入警告信息，只取从第一个 "{" 开始的 JSON 内容
		const start = out.indexOf("{");
		if (start < 0) throw new Error("输出中未找到 JSON 内容");
		return { data: JSON.parse(out.slice(start)), file: item.file };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`读取配置失败（${key}）: ${msg}`);
	}
}

/**
 * 重写整个配置文件：
 * 保留目标导出声明之前的所有内容（import、工具函数、注释、其它导出），
 * 仅把目标导出变量替换为序列化后的新值。
 */
export function buildConfigFileContent(key: string, data: unknown): string {
	const item = loadItem(key);
	const filePath = path.resolve(projectRoot, item.file);
	let raw = "";
	if (fs.existsSync(filePath)) raw = fs.readFileSync(filePath, "utf8");
	const marker = `export const ${item.exportName}`;
	const idx = raw.indexOf(marker);
	const prefix = idx >= 0 ? raw.slice(0, idx) : "";
	// 提取当前导出的对象字面量，收集其中注释，序列化时按键路径回填，避免保存后丢失注释
	const openIdx = idx >= 0 ? raw.indexOf("{", idx) : -1;
	let comments: Map<string, string[]> | undefined;
	let closeIdx = -1;
	if (openIdx >= 0) {
		closeIdx = matchClosingBrace(raw, openIdx);
		if (closeIdx > openIdx) {
			const literal = raw.slice(openIdx, closeIdx + 1);
			comments = collectComments(literal);
		}
	}
	const body = serializeValue(data, "", comments, "");
	// 目标导出之后的文件内容（如 pioConfig.ts 中多个导出）也需保留，否则会被丢弃
	const suffix = openIdx >= 0 && closeIdx > openIdx ? raw.slice(closeIdx + 1) : "";
	const tail = suffix || ";\n";
	return `${prefix}export const ${item.exportName}: ${item.typeName} = ${body}${tail}`;
}

/**
 * 保存配置：先写本地文件（保证开发体验），再尝试同步到 GitHub。
 * github-app 依赖 import.meta.env（Vite 注入），因此懒加载以避免模块顶层求值。
 */
export async function saveConfigJson(
	key: string,
	data: unknown,
): Promise<{ file: string; local: boolean; github: boolean }> {
	const item = loadItem(key);
	// html 等原始文本配置：直接以传入内容作为文件内容，避免 TS 序列化
	const content =
		item.kind === "html"
			? (data as string)
			: buildConfigFileContent(key, data);
	const { saveFileLocally, saveFileToGitHub } = await import("./github-app");
	const local = saveFileLocally(item.file, content);
	const github = await saveFileToGitHub(
		item.file,
		content,
		`update config (${key}) via admin dashboard`,
	);
	if (!local && !github) throw new Error("保存失败（本地与 GitHub 均失败）");
	return { file: item.file, local, github };
}
