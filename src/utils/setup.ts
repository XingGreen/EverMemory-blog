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

// 进程内缓存：生成后避免重复写入/覆盖 .env.local
let cachedSetupToken: string | null = null;

/** 是否已完成初始化（ADMIN_PASSWORD 已配置，文件优先实时检测） */
export function isInitialized(): boolean {
	return readSecretStates().ADMIN_PASSWORD === true;
}

/** 读取或（惰性）生成一次性安装令牌；只读环境或无此场景返回 null */
export function getSetupToken(): string | null {
	if (!isEnvFileWritable()) return null;
	if (cachedSetupToken) return cachedSetupToken;

	// 优先使用部署者预置的令牌（.env.local 文件或环境变量）
	const fileToken = readSecretPreview(SETUP_TOKEN_KEY);
	if (fileToken) {
		cachedSetupToken = fileToken;
		return fileToken;
	}
	const envToken = import.meta.env.ADMIN_SETUP_TOKEN || "";
	if (envToken) {
		cachedSetupToken = envToken;
		return envToken;
	}

	// 无预置令牌：生成并写入 .env.local，同时打印到终端日志供部署者获取
	const token = crypto.randomBytes(24).toString("base64url");
	applyEnvFileUpdates([{ key: SETUP_TOKEN_KEY, value: token }]);
	cachedSetupToken = token;
	console.log(
		`[Setup] 首次初始化安装令牌（一次性，用于设置管理员账号）: ${token}`,
	);
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

/** 焚毁安装令牌：清内存缓存 + 从 .env.local 删除该键 */
export function consumeSetupToken(): void {
	cachedSetupToken = null;
	applyEnvFileUpdates([{ key: SETUP_TOKEN_KEY, delete: true }]);
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
	];
	if (!readSecretStates().ADMIN_JWT_SECRET) {
		updates.push({ key: "ADMIN_JWT_SECRET", value: generateJwtSecret() });
	}
	applyEnvFileUpdates(updates);
	consumeSetupToken();
}
