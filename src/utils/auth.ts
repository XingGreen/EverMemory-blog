import crypto from "node:crypto";

import { getEnv } from "./env";
import {
	applyEnvFileUpdates,
	hashAdminPassword,
	isEnvFileWritable,
	readSecretPreview,
	readSecretValue,
	scryptCostFactor,
	shouldRehash,
	verifyPasswordHash,
} from "./secret-io";
import { getSession, touchSession } from "./session-store";

const JWT_EXPIRY_HOURS = 12;

// 会话 Cookie 有效时长
export const SESSION_MAX_AGE = JWT_EXPIRY_HOURS * 3600; // 12 小时（未勾选"记住我"）
export const REMEMBER_MAX_AGE = 7 * 24 * 3600; // 7 天（勾选"记住我"）

/**
 * 后台会话角色：
 * - admin：主空间，日常后台全部功能；
 * - super：第二空间（应急控制台），主空间能力 + 控制面（踢会话 / 封禁 / 改运行时配置）。
 */
export type AdminRole = "admin" | "super";

/** 应急控制台会话时长：1 小时，且不提供「记住我」（设计决策 Q8） */
export const SUPER_SESSION_MAX_AGE = 3600;

/** 会话撤销版本号所存储的环境变量键；修改认证信息时 +1，旧会话立即失效 */
const TOKEN_VER_KEY = "ADMIN_TOKEN_VER";

let cachedSecret: string | null = null;

/**
 * 当前会话令牌版本号：读取 .env.local 的 ADMIN_TOKEN_VER（文件优先实时，
 * 保证改密/改钥后同进程内旧令牌立即失效）；未配置视为 0。
 */
function getTokenVersion(): string {
	try {
		return readSecretPreview(TOKEN_VER_KEY) || "0";
	} catch {
		return "0";
	}
}

/**
 * 获取 JWT 签名密钥
 * - 优先读取 ADMIN_JWT_SECRET 环境变量
 * - 生产环境未配置时抛错，防止使用可预测的默认密钥导致令牌被伪造
 * - 开发环境未配置时生成临时随机密钥（进程重启后失效）并打印警告
 */
function getJwtSecret(): string {
	if (cachedSecret) return cachedSecret;

	const envSecret = getEnv("ADMIN_JWT_SECRET");
	if (envSecret) {
		cachedSecret = envSecret;
		return envSecret;
	}

	if (import.meta.env.PROD) {
		const msg =
			"ADMIN_JWT_SECRET 环境变量未设置。请参考 .env.example 配置一个足够随机的密钥后再启动生产服务。";
		console.error(`[Auth] ${msg}`);
		throw new Error(msg);
	}

	// 仅开发环境：生成临时随机密钥（进程重启后失效）
	cachedSecret = crypto.randomBytes(32).toString("hex");
	console.warn(
		"[Auth] ADMIN_JWT_SECRET 未配置，已生成临时开发密钥。会话将在进程重启后失效，请尽快在 .env.local 中配置 ADMIN_JWT_SECRET。",
	);
	return cachedSecret;
}

interface JwtPayload {
	sub: string;
	role: AdminRole;
	/** 会话撤销版本号：与 .env.local 的 ADMIN_TOKEN_VER 一致才有效 */
	ver: string;
	/** 会话 ID：对应服务端会话表中的记录（被踢下线后此 ID 失效） */
	sid: string;
	iat: number;
	exp: number;
}

export function generateSessionToken(
	maxAgeSeconds = SESSION_MAX_AGE,
	sid?: string,
	role: AdminRole = "admin",
): string {
	const payload: JwtPayload = {
		sub: crypto.randomUUID(),
		role,
		ver: getTokenVersion(),
		sid: sid || crypto.randomUUID(),
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
	};

	const header = { alg: "HS256", typ: "JWT" };

	const base64Url = (obj: object) =>
		Buffer.from(JSON.stringify(obj))
			.toString("base64")
			.replace(/=/g, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");

	const headerB64 = base64Url(header);
	const payloadB64 = base64Url(payload);
	const signInput = `${headerB64}.${payloadB64}`;

	const signature = crypto
		.createHmac("sha256", getJwtSecret())
		.update(signInput)
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");

	return `${signInput}.${signature}`;
}

/** 校验会话令牌；有效返回解析后的 payload，无效返回 null（签名错/过期/版本不符/已被踢） */
export async function verifySessionToken(
	token: string,
): Promise<JwtPayload | null> {
	try {
		if (!token) return null;

		const parts = token.split(".");
		if (parts.length !== 3) return null;

		const [headerB64, payloadB64, signature] = parts;
		const signInput = `${headerB64}.${payloadB64}`;

		const expectedSignature = crypto
			.createHmac("sha256", getJwtSecret())
			.update(signInput)
			.digest("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=/g, "");

		if (signature !== expectedSignature) {
			return null;
		}

		const payload = JSON.parse(
			Buffer.from(
				payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
				"base64",
			).toString(),
		) as JwtPayload;

		if (payload.exp < Math.floor(Date.now() / 1000)) {
			return null;
		}

		if (payload.role !== "admin" && payload.role !== "super") {
			return null;
		}

		// 撤销广播：令牌签发时的版本号必须与当前一致（改密/改钥后旧会话立即失效）
		if (payload.ver !== getTokenVersion()) {
			return null;
		}

		// 会话表检查：sid 必须存在且未过期（被「踢下线」后此校验即失败）
		// 无 sid 的旧令牌（升级前签发）一律视为无效，强制重新登录以登记会话
		if (!payload.sid) return null;
		const session = await getSession(payload.sid);
		if (!session) return null;

		return payload;
	} catch {
		return null;
	}
}

export function getAuthTokenFromRequest(request: Request): string | null {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(";").map((c) => c.trim());
	for (const cookie of cookies) {
		const [name, value] = cookie.split("=");
		if (name === "admin_session" && value) {
			return decodeURIComponent(value);
		}
	}

	return null;
}

export async function requireAuth(request: Request): Promise<{
	authenticated: boolean;
	payload?: JwtPayload;
	response?: Response;
}> {
	const token = getAuthTokenFromRequest(request);

	if (!token) {
		return {
			authenticated: false,
			response: new Response(
				JSON.stringify({ success: false, message: "未授权或会话已过期" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	const payload = await verifySessionToken(token);

	if (!payload) {
		return {
			authenticated: false,
			response: new Response(
				JSON.stringify({ success: false, message: "未授权或会话已过期" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	// 顺手更新「最后活跃」（内部节流，不阻塞请求）
	void touchSession(payload.sid).catch(() => {});

	return { authenticated: true, payload };
}

/**
 * 控制面专用授权：要求已登录且处于 super 空间（应急控制台）。
 * 主空间（admin）会话访问控制面一律 403——踢人权只在第二空间，
 * 攻击者即使拿到主会话也无法夺走控制权。
 */
export async function requireSuperAuth(request: Request): Promise<{
	authenticated: boolean;
	payload?: JwtPayload;
	response?: Response;
}> {
	const auth = await requireAuth(request);
	if (!auth.authenticated) return auth;

	if (auth.payload?.role !== "super") {
		return {
			authenticated: false,
			payload: auth.payload,
			response: new Response(
				JSON.stringify({
					success: false,
					message: "该操作仅限应急控制台，请改用第二密码进入",
				}),
				{ status: 403, headers: { "Content-Type": "application/json" } },
			),
		};
	}

	return auth;
}

export function setAuthCookie(
	token: string,
	headers: Headers,
	maxAgeSeconds = SESSION_MAX_AGE,
): void {
	headers.set(
		"Set-Cookie",
		`admin_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`,
	);
}

export function clearAuthCookie(headers: Headers): void {
	headers.set(
		"Set-Cookie",
		"admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
	);
}

/**
 * 验证管理员密码
 * 环境变量 ADMIN_PASSWORD 存储 scrypt 哈希（scrypt$N$salt$hash）；
 * 兼容旧版 SHA256 hex。使用 timingSafeEqual 防止时序攻击。
 * 旧版 SHA256 验证通过后会自动迁移为 scrypt 并写回 .env.local。
 */
export function verifyAdminPassword(password: string): boolean {
	try {
		if (!password) return false;

		const storedHash = readSecretPreview("ADMIN_PASSWORD");
		if (!storedHash) {
			console.error("[Auth] ADMIN_PASSWORD 环境变量未配置，无法验证管理员密码");
			return false;
		}

		const ok = verifyPasswordHash(password, storedHash);
		if (!ok) return false;

		// 自动迁移：旧 SHA256 哈希 → scrypt；或 scrypt 成本参数偏低 → 当前目标 N
		// （重启后完全生效；文件不可写时保持原样，不影响本次验证）
		if (shouldRehash(storedHash) && isEnvFileWritable()) {
			try {
				const upgraded = hashAdminPassword(password);
				applyEnvFileUpdates([{ key: "ADMIN_PASSWORD", value: upgraded }]);
				console.log(
					`[Auth] ADMIN_PASSWORD 已验证并自动升级为 scrypt$${scryptCostFactor(upgraded)} 哈希（重启后完全生效）`,
				);
			} catch {
				// 文件系统不可写：保持旧格式，不影响本次验证
			}
		}

		return true;
	} catch (error) {
		console.error(
			"[Auth] 管理员密码验证异常:",
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}

/**
 * 第二密码（应急控制台）是否已配置。
 * 未配置时登录降级为主空间，控制面改为主密码二次验证（设计决策 Q6）。
 */
export function isSuperPasswordConfigured(): boolean {
	try {
		return readSecretValue("ADMIN_SUPER_PASSWORD") !== "";
	} catch {
		return false;
	}
}

/**
 * 验证「第二密码」（应急控制台）。
 * 独立于主密码：只从 .env.local / 平台 env 读取，不提供 Web 修改，也不做自动迁移。
 * 未配置时一律返回 false。
 */
export function verifySuperPassword(password: string): boolean {
	try {
		if (!password) return false;
		const storedHash = readSecretValue("ADMIN_SUPER_PASSWORD");
		if (!storedHash) return false;
		return verifyPasswordHash(password, storedHash);
	} catch (error) {
		console.error(
			"[Auth] 第二密码验证异常:",
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}

/**
 * 验证管理员用户名
 * 环境变量 ADMIN_USERNAME 默认为 "admin"
 * 使用 timingSafeEqual 防止时序攻击
 */
export function verifyAdminUsername(username: string): boolean {
	try {
		if (!username) return false;

		const storedUsername = getEnv("ADMIN_USERNAME") || "admin";

		const inputBuf = Buffer.from(username);
		const storedBuf = Buffer.from(storedUsername);

		if (inputBuf.length !== storedBuf.length) {
			return false;
		}

		return crypto.timingSafeEqual(inputBuf, storedBuf);
	} catch (error) {
		console.error(
			"[Auth] 管理员用户名验证异常:",
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}
