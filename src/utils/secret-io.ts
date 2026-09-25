/**
 * 密钥的读取 / 状态检测 / 写回（仅服务端使用，含 fs/crypto，勿在前端组件中 import）
 *
 * 状态检测策略：
 *  - 优先读取项目根 .env.local 磁盘文件（实时反映 WebUI 的改动，进程无需重启也能看到新状态）
 *  - .env.local 中没有的键回退到 import.meta.env（Vercel 等平台环境变量）
 *
 * 注意：.env.local 写入后，当前进程的 import.meta.env 仍是启动时的旧快照；
 * 真正的生效（如登录密码、GitHub 同步）需要重启服务，API 会对此作出提示。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENV_FILE_NAME = ".env.local";

function envFilePath(): string {
	return path.resolve(process.cwd(), ENV_FILE_NAME);
}

// 静态取值映射：import.meta.env 不支持动态索引，只能逐个静态访问
const ENV_GETTERS: Record<string, () => string> = {
	GITHUB_APP_ID: () => import.meta.env.GITHUB_APP_ID || "",
	GITHUB_OWNER: () => import.meta.env.GITHUB_OWNER || "",
	GITHUB_REPO: () => import.meta.env.GITHUB_REPO || "",
	GITHUB_BRANCH: () => import.meta.env.GITHUB_BRANCH || "",
	GITHUB_INSTALLATION_ID: () => import.meta.env.GITHUB_INSTALLATION_ID || "",
	GITHUB_PRIVATE_KEY: () => import.meta.env.GITHUB_PRIVATE_KEY || "",
	GITHUB_PRIVATE_KEY_PATH: () => import.meta.env.GITHUB_PRIVATE_KEY_PATH || "",
	ADMIN_USERNAME: () => import.meta.env.ADMIN_USERNAME || "",
	ADMIN_PASSWORD: () => import.meta.env.ADMIN_PASSWORD || "",
	ADMIN_JWT_SECRET: () => import.meta.env.ADMIN_JWT_SECRET || "",
};

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
 * 优先 .env.local 文件（实时反映 WebUI 改动），其次 import.meta.env 快照。
 */
function readEnvValue(key: string): string {
	try {
		if (fs.existsSync(envFilePath())) {
			const fileValues = parseEnvFile(fs.readFileSync(envFilePath(), "utf8"));
			if (key in fileValues) return fileValues[key];
		}
	} catch {
		// 文件读取失败时回退到 import.meta.env
	}
	try {
		const getter = ENV_GETTERS[key];
		return getter ? getter() : "";
	} catch {
		// 非 Vite 运行环境（如 node 脚本）无 import.meta.env，视为未配置
		return "";
	}
}

/** 返回所有密钥的配置状态（敏感值绝不返回真实内容） */
export function readSecretStates(): Record<string, boolean> {
	const states: Record<string, boolean> = {};
	for (const key of Object.keys(ENV_GETTERS)) {
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

/** scrypt 成本参数（迭代次数）；显式写入哈希格式便于未来升级 */
const SCRYPT_N = 16384;

/**
 * 生成管理员密码哈希：scrypt 加盐哈希，格式 `scrypt$N$salt$hash`
 * （salt 16 字节随机，hash 64 字节；均 base64）。
 * 取代早先的裸 SHA256：防彩虹表/高速破解。
 */
export function hashAdminPassword(plain: string): string {
	const salt = crypto.randomBytes(16);
	const hash = crypto.scryptSync(plain, salt, 64, { N: SCRYPT_N });
	return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** 是否为 scrypt 哈希格式（否则视为旧版 SHA256 hex） */
export function isScryptHash(stored: string): boolean {
	return typeof stored === "string" && stored.startsWith("scrypt$");
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
			const salt = Buffer.from(hasN ? parts[2] : parts[1] ?? "", "base64");
			const hash = Buffer.from(hasN ? parts[3] : parts[2] ?? "", "base64");
			const N = hasN ? Number(parts[1]) : SCRYPT_N;
			if (salt.length === 0 || hash.length === 0) return false;
			const computed = crypto.scryptSync(plain, salt, 64, { N });
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
	for (const key of Object.keys(ENV_GETTERS)) {
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
