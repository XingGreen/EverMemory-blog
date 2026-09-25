/**
 * 首次初始化引导（仅服务端使用）
 *
 * 全新部署（未配置 ADMIN_PASSWORD）时登录不可用，需要一个免认证入口完成初始化。
 * 为了防止公网站点被抢注（任意访问者抢先设置管理员账号），初始化必须携带
 * 一次性安装令牌：
 *  - 未初始化且文件系统可写时，首次访问登录页会惰性生成令牌：
 *    写入 .env.local 的 ADMIN_SETUP_TOKEN，同时打印到服务端终端日志
 *  - 校验通过并写入账号/密码/JWT 密钥后，令牌立即焚毁（删除），不可重放
 *  - 文件系统只读（Vercel 等）时无需令牌，直接提示部署者去平台配置
 *
 * 注意：.env.local 写入后，当前进程的 import.meta.env 仍是启动时的旧快照；
 * 真正的生效需要重启服务，API 会对此作出提示。
 */
import crypto from "node:crypto";
import {
	applyEnvFileUpdates,
	generateJwtSecret,
	hashAdminPassword,
	isEnvFileWritable,
	readSecretPreview,
	readSecretStates,
} from "./secret-io";

const SETUP_TOKEN_KEY = "ADMIN_SETUP_TOKEN";
const SETUP_TOKEN_EXPIRES_KEY = "ADMIN_SETUP_TOKEN_EXPIRES";
const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;

// 进程内缓存：TTL 内避免重复写入/覆盖 .env.local
let cachedSetupToken: string | null = null;
let cachedSetupTokenAt = 0;

/** 是否已完成初始化（ADMIN_PASSWORD 已配置，文件优先实时检测） */
export function isInitialized(): boolean {
	return readSecretStates().ADMIN_PASSWORD === true;
}

/** 读取 .env.local 中存储的令牌与过期时间（无过期时间视为部署者预置，永不过期） */
function readStoredToken(): { token: string; expiresAt: number | null } | null {
	const token = readSecretPreview(SETUP_TOKEN_KEY);
	if (!token) return null;
	const rawExpires = readSecretPreview(SETUP_TOKEN_EXPIRES_KEY);
	const parsed = rawExpires ? Date.parse(rawExpires) : Number.NaN;
	return { token, expiresAt: Number.isNaN(parsed) ? null : parsed };
}

/**
 * 读取或（惰性）生成一次性安装令牌；只读环境或无此场景返回 null。
 *  - TTL 内（进程缓存或 .env.local 中未过期）复用同一令牌，避免多标签页互相失效
 *  - 过期后自动重新生成并覆盖旧值，旧令牌立即失效（防重放 + 防止悬挂）
 *  - 部署者预置的令牌（无过期时间字段）视为有意配置，永不过期
 * @param origin 触发生成时的访问地址（用于终端日志提示）
 */
export function getSetupToken(origin?: string): string | null {
	if (!isEnvFileWritable()) return null;

	// 进程内缓存仍在有效期内：直接复用
	if (
		cachedSetupToken &&
		Date.now() - cachedSetupTokenAt < SETUP_TOKEN_TTL_MS
	) {
		return cachedSetupToken;
	}

	// .env.local 中存在有效令牌（未过期或无过期时间）：复用
	const stored = readStoredToken();
	if (stored) {
		if (stored.expiresAt === null || stored.expiresAt > Date.now()) {
			cachedSetupToken = stored.token;
			cachedSetupTokenAt = Date.now();
			return stored.token;
		}
	}

	// 无有效令牌：生成新令牌并写入（覆盖已过期的旧值）
	const token = crypto.randomBytes(24).toString("base64url");
	const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS).toISOString();
	applyEnvFileUpdates([
		{ key: SETUP_TOKEN_KEY, value: token },
		{ key: SETUP_TOKEN_EXPIRES_KEY, value: expiresAt },
	]);
	cachedSetupToken = token;
	cachedSetupTokenAt = Date.now();
	console.log(
		`[Setup] 控制台首次初始化安装令牌（一次性，${SETUP_TOKEN_TTL_MS / 60000} 分钟内有效）`,
	);
	console.log(`  访问地址: ${origin ?? "控制台登录页"}`);
	console.log(`  安装令牌: ${token}`);
	console.log("  提示: 初始化完成后令牌自动删除，请勿将令牌交给不可信方");
	return token;
}

/** 校验用户提交的安装令牌（timingSafeEqual 防时序攻击） */
export function verifySetupToken(input: string): boolean {
	const expected = getSetupToken();
	if (!expected || !input) return false;
	const a = Buffer.from(input);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

/** 焚毁安装令牌：清内存缓存 + 从 .env.local 删除令牌及其过期时间 */
export function consumeSetupToken(): void {
	cachedSetupToken = null;
	cachedSetupTokenAt = 0;
	applyEnvFileUpdates([
		{ key: SETUP_TOKEN_KEY, delete: true },
		{ key: SETUP_TOKEN_EXPIRES_KEY, delete: true },
	]);
}

/**
 * 完成初始化：一次性写入 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_JWT_SECRET，
 * 并焚毁安装令牌。
 * - 用户名缺省回退 "admin"
 * - ADMIN_JWT_SECRET 已配置则保留，避免无意义地轮换签名密钥
 */
export function finishSetup(username: string, password: string): void {
	const name = username.trim() || "admin";
	const updates: { key: string; value: string }[] = [
		{ key: "ADMIN_USERNAME", value: name },
		{ key: "ADMIN_PASSWORD", value: hashAdminPassword(password) },
		{ key: "ADMIN_TOKEN_VER", value: "1" },
	];
	if (!readSecretStates().ADMIN_JWT_SECRET) {
		updates.push({ key: "ADMIN_JWT_SECRET", value: generateJwtSecret() });
	}
	applyEnvFileUpdates(updates);
	consumeSetupToken();
}
