/**
 * 密钥的读取 / 状态检测 / 写回（仅服务端使用，含 fs/crypto，勿在前端组件中 import）
 *
 * 状态检测策略：
 *  - 优先读取项目根 .env.local 磁盘文件（实时反映 WebUI 的改动，进程无需重启也能看到新状态）
 *  - .env.local 中没有的键回退到平台/运行时环境变量（Vercel 等：process.env，本地 dev：import.meta.env）
 *
 * 注意：.env.local 写入后，当前进程的 import.meta.env 仍是启动时的旧快照；
 * 真正的生效（如登录密码、GitHub 同步）需要重启服务，API 会对此作出提示。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ENV_KEYS, getEnv } from "./env";

const ENV_FILE_NAME = ".env.local";

function envFilePath(): string {
	return path.resolve(process.cwd(), ENV_FILE_NAME);
}

/** 生产构建（Vercel / Cloudflare Workers 等）文件系统只读 */
export function isEnvFileWritable(): boolean {
	return !import.meta.env?.PROD;
}

/** 解析 .env 文件内容为键值映射（自动处理引号与转义，忽略注释） */
function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = line.slice(eq + 1).trim();
		// dotenv 双引号值与 JSON 字符串转义规则一致，直接用 JSON.parse 反转义
		if (value.startsWith('"') && value.endsWith('"')) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

/**
 * 查询单个环境变量的当前值：
 * 优先 .env.local 文件（实时反映 WebUI 改动），其次平台/运行时环境变量（process.env），
 * 最后 import.meta.env 快照（本地 dev 由 Vite 注入）。
 */
function readEnvValue(key: string): string {
	try {
		if (fs.existsSync(envFilePath())) {
			const fileValues = parseEnvFile(fs.readFileSync(envFilePath(), "utf8"));
			if (key in fileValues) return fileValues[key];
		}
	} catch {
		// 文件读取失败时回退到平台环境变量
	}
	return getEnv(key);
}

/** 返回所有密钥的配置状态（敏感值绝不返回真实内容） */
export function readSecretStates(): Record<string, boolean> {
	const states: Record<string, boolean> = {};
	for (const key of ENV_KEYS) {
		states[key] = readEnvValue(key) !== "";
	}
	return states;
}

/** 读取单个非敏感密钥的真实值（用于表单回显；敏感密钥请勿调用） */
export function readSecretPreview(key: string): string {
	return readEnvValue(key);
}

/** 值转义：私钥原文自动转 Base64（与 github-app.ts 读取逻辑兼容），含特殊字符时加引号 */
function quoteEnvValue(raw: string): string {
	let value = raw;
	if (value.includes("-----BEGIN")) {
		value = Buffer.from(value, "utf8").toString("base64");
	}
	if (/[\s#"'\\]/.test(value)) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

/**
 * 将一批密钥更新（新增/覆写/删除）应用到 .env.local：
 * 保留原有注释、顺序与无关行；删除键时移除对应赋值行；文件不存在则创建。
 */
export function applyEnvFileUpdates(
	entries: { key: string; value?: string; delete?: boolean }[],
): { updated: string[]; removed: string[] } {
	const filePath = envFilePath();
	const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
	const lines = raw.split(/\r?\n/);
	const entryByKey = new Map(entries.map((e) => [e.key, e]));
	const updated: string[] = [];
	const removed: string[] = [];
	const handled = new Set<string>();
	const out: string[] = [];

	for (const line of lines) {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
		if (match) {
			const key = match[1];
			const entry = entryByKey.get(key);
			if (entry) {
				handled.add(key);
				if (entry.delete) {
					removed.push(key);
					continue;
				}
				if (entry.value !== undefined && entry.value !== "") {
					out.push(`${key}=${quoteEnvValue(entry.value)}`);
					updated.push(key);
					continue;
				}
			}
		}
		out.push(line);
	}

	// 文件中原不存在的键：新增（删除操作与空值无需追加）
	for (const entry of entries) {
		if (handled.has(entry.key)) continue;
		if (entry.delete) {
			removed.push(entry.key);
			continue;
		}
		if (entry.value === undefined || entry.value === "") continue;
		out.push(`${entry.key}=${quoteEnvValue(entry.value)}`);
		updated.push(entry.key);
	}

	let content = out.join("\n");
	if (content && !content.endsWith("\n")) content += "\n";
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");

	return { updated, removed };
}

// ── 生成工具（与 .env.example 中的生成命令保持一致） ──

/** 生成 JWT 签名密钥：32 字节随机 hex（64 位） */
export function generateJwtSecret(): string {
	return crypto.randomBytes(32).toString("hex");
}

/**
 * scrypt 目标成本参数 N（迭代次数）。
 * 默认 2^17，与 OWASP 推荐的 N=2^17 / r=8 / p=1 对齐；原先的 16384(2^14)
 * 是 OWASP 的最低档，拿到哈希后可被离线爆破，成本偏低故上调。
 *
 * 注意内存占用 ≈ 128 × N × r = 1024 × N 字节：
 *   N=2^14 → 16MB，N=2^15 → 32MB，N=2^17 → 128MB。
 * Node 默认 maxmem 只有 32MB，超过就必须显式传 maxmem（见 SCRYPT_MAXMEM）；
 * Cloudflare Workers 内存硬上限 128MB，跑 2^17 会直接 OOM，
 * 故提供 ADMIN_SCRYPT_N 环境变量按部署环境下调。
 */
const SCRYPT_N = 131072;

/** scrypt maxmem（字节）：需 ≥ 128 × N × r + 128 × r × p + 256 × r，2^17 时约 128MB */
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/**
 * 生成管理员密码哈希：scrypt 加盐哈希，格式 `scrypt$N$salt$hash`
 * （salt 16 字节随机，hash 64 字节；均 base64）。
 * 取代早先的裸 SHA256：防彩虹表/高速破解。
 */
export function hashAdminPassword(plain: string): string {
	const N = targetScryptN();
	const salt = crypto.randomBytes(16);
	const hash = crypto.scryptSync(plain, salt, 64, { N, maxmem: SCRYPT_MAXMEM });
	return `scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** 当前应当使用的目标 N：ADMIN_SCRYPT_N 可覆盖（供低内存环境下调） */
function targetScryptN(): number {
	const override = Number(readEnvValue("ADMIN_SCRYPT_N"));
	if (Number.isFinite(override) && override >= 1024) return override;
	return SCRYPT_N;
}

/** 是否为 scrypt 哈希格式（否则视为旧版 SHA256 hex） */
export function isScryptHash(stored: string): boolean {
	return typeof stored === "string" && stored.startsWith("scrypt$");
}

/**
 * 读取已存哈希使用的 N；非 scrypt 格式返回 0（调用方据此判定需迁移）。
 * scrypt$N$salt$hash 或兼容省略 N 的 scrypt$salt$hash。
 */
export function scryptCostFactor(stored: string): number {
	if (!isScryptHash(stored)) return 0;
	const parts = stored.split("$");
	const hasN = parts.length === 4 && /^\d+$/.test(parts[1]);
	return hasN ? Number(parts[1]) : 16384;
}

/** 已存哈希是否需要在下次验证成功后重算升级（非 scrypt 格式，或成本参数低于当前目标） */
export function shouldRehash(stored: string): boolean {
	const n = scryptCostFactor(stored);
	return n === 0 || n < targetScryptN();
}

/**
 * 校验明文密码是否匹配存储哈希（scrypt 或旧版 SHA256 hex）。
 * 使用 timingSafeEqual 防止时序攻击；格式/参数异常一律返回 false。
 */
export function verifyPasswordHash(plain: string, stored: string): boolean {
	try {
		if (!plain || !stored) return false;
		if (isScryptHash(stored)) {
			const parts = stored.split("$");
			// scrypt$N$salt$hash 或兼容省略 N 的 scrypt$salt$hash
			const hasN = parts.length === 4 && /^\d+$/.test(parts[1]);
			const salt = Buffer.from(hasN ? parts[2] : (parts[1] ?? ""), "base64");
			const hash = Buffer.from(hasN ? parts[3] : (parts[2] ?? ""), "base64");
			// 一律按哈希里记录的 N 校验，旧哈希因此不受升级影响；
			// maxmem 必须给足，否则 N 偏大的旧哈希会因超限直接失败
			const N = hasN ? Number(parts[1]) : 16384;
			if (salt.length === 0 || hash.length === 0) return false;
			const computed = crypto.scryptSync(plain, salt, 64, { N, maxmem: SCRYPT_MAXMEM });
			if (computed.length !== hash.length) return false;
			return crypto.timingSafeEqual(computed, hash);
		}
		// 旧格式：SHA256 的 hex 串
		const inputHash = crypto
			.createHash("sha256")
			.update(plain, "utf8")
			.digest("hex");
		const inputBuf = Buffer.from(inputHash, "hex");
		const storedBuf = Buffer.from(stored, "hex");
		if (inputBuf.length !== storedBuf.length) return false;
		return crypto.timingSafeEqual(inputBuf, storedBuf);
	} catch {
		return false;
	}
}

/** 读取全部密钥的真实值（仅服务端导出场景使用；敏感值请谨慎处理） */
export function readAllSecretValues(): Record<string, string> {
	const values: Record<string, string> = {};
	for (const key of ENV_KEYS) {
		values[key] = readEnvValue(key);
	}
	return values;
}

/**
 * 私钥还原：.env.local 中的私钥可能被 quoteEnvValue 自动存为 Base64，
 * 导出到生产环境时还原为 PEM 原文（平台环境变量面板更友好）。
 * 已含 PEM 头或解码结果不含 PEM 头时保持原文。
 */
export function decodePrivateKey(value: string): string {
	if (!value || value.includes("-----BEGIN")) return value;
	try {
		const decoded = Buffer.from(value, "base64").toString("utf8");
		if (decoded.includes("-----BEGIN") && decoded.includes("-----END")) {
			return decoded;
		}
	} catch {
		// 非 Base64（或解码失败）时保持原文
	}
	return value;
}

/**
 * 校验"当前登录密码"：对比 .env.local 中当前生效的 ADMIN_PASSWORD 哈希
 * （文件优先实时读取，避免 import.meta.env 启动快照导致的误判）。
 * 用于修改认证信息（用户名 / 密码 / JWT 密钥）时的二次确认，防 CSRF/会话劫持。
 */
export function verifyCurrentPassword(plain: string): boolean {
	try {
		if (!plain) return false;
		const storedHash = readEnvValue("ADMIN_PASSWORD");
		if (!storedHash) return false;
		return verifyPasswordHash(plain, storedHash);
	} catch {
		return false;
	}
}

/**
 * 会话令牌版本号 +1 并写回 .env.local（ADMIN_TOKEN_VER）。
 * 用于"修改认证信息后使所有旧会话立即失效"的撤销广播。
 * 返回新版本号；无法读取/写入时返回 -1（调用方应忽略）。
 */
export function incrementTokenVersion(): number {
	try {
		const current = Number(readEnvValue("ADMIN_TOKEN_VER")) || 0;
		const next = current + 1;
		applyEnvFileUpdates([{ key: "ADMIN_TOKEN_VER", value: String(next) }]);
		return next;
	} catch {
		return -1;
	}
}
