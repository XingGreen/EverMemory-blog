/**
 * 密钥导出（仅服务端使用）：生成 .env 文件内容或 Vercel CLI 命令，
 * 供部署者在本地配置完成后导入生产环境（Vercel / 自托管等）。
 *
 * 规则：
 *  - 仅导出已在 .env.local 中配置的项；未配置项以注释占位，方便对照补齐
 *  - GITHUB_PRIVATE_KEY_PATH 仅本地使用，不导出
 *  - GITHUB_PRIVATE_KEY 统一导出为 Base64 单行（适配 Vercel 环境变量不支持换行的限制，与保存时行为一致）
 */
import { ADMIN_SECRETS } from "./admin-secrets";
import { readAllSecretValues } from "./secret-io";

/** 仅本地开发使用、无需导出到生产的键 */
const LOCAL_ONLY_KEYS = new Set(["GITHUB_PRIVATE_KEY_PATH"]);

/** dotenv 兼容转义：含空白/特殊字符时加双引号 */
function quoteEnv(value: string): string {
	if (/[\s#"'\\]/.test(value)) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

/** shell 单引号转义（用于 printf 传参，可安全包含换行） */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 导出项：跳过本地专用键；私钥统一转 Base64，已是 Base64 则保持 */
function normalizeValue(key: string, value: string): string {
	if (key !== "GITHUB_PRIVATE_KEY") return value;
	if (value.includes("-----BEGIN")) {
		return Buffer.from(value, "utf8").toString("base64");
	}
	return value;
}

/** 生成 .env 文件内容（通用格式，可在 Vercel / Docker / 服务器使用） */
export function buildEnvExport(): string {
	const values = readAllSecretValues();
	const lines: string[] = [
		"# EverMemory 密钥导出（由本机 .env.local 生成）",
		`# 生成时间: ${new Date().toISOString()}`,
		"# 警告：本文件包含敏感密钥，请勿提交到 Git，导入生产环境后请即删。",
		"",
	];
	for (const item of ADMIN_SECRETS) {
		if (LOCAL_ONLY_KEYS.has(item.key)) continue;
		const value = values[item.key] ?? "";
		if (!value) {
			lines.push(`# ${item.key}=（未配置）`);
			continue;
		}
		lines.push(`${item.key}=${quoteEnv(normalizeValue(item.key, value))}`);
	}
	return `${lines.join("\n")}\n`;
}

/** 生成 Vercel CLI 命令块（逐条写入 production 环境） */
export function buildVercelCliCommands(): string {
	const values = readAllSecretValues();
	const lines: string[] = [
		"# 在终端执行以下命令，把密钥逐条写入 Vercel（production 环境）",
		"# 前置：npm i -g vercel && vercel login && vercel link",
		"# 说明：需要 preview / development 环境时，把命令末尾的 production 替换即可",
		"",
	];
	for (const item of ADMIN_SECRETS) {
		if (LOCAL_ONLY_KEYS.has(item.key)) continue;
		const value = values[item.key] ?? "";
		if (!value) {
			lines.push(`# SKIP ${item.key}（未配置，请先在本地配置）`);
			continue;
		}
		const raw = normalizeValue(item.key, value);
		lines.push(
			`printf '%s' ${shellQuote(raw)} | vercel env add ${item.key} production`,
		);
	}
	return `${lines.join("\n")}\n`;
}
