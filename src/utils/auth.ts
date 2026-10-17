import crypto from "node:crypto";

import { getEnv } from "./env";
import { readSecretPreview, readSecretValue } from "./secret-io";
import { getSession, touchSession } from "./session-store";

const JWT_EXPIRY_HOURS = 12;

// 会话 Cookie 有效时长
export const SESSION_MAX_AGE = JWT_EXPIRY_HOURS * 3600; // 12 小时（未勾选"记住我"）
export const REMEMBER_MAX_AGE = 7 * 24 * 3600; // 7 天（勾选"记住我"）

/**
 * 本次会话的认证方式（authentication method reference）：
 * - github：GitHub OAuth（主登录）
 * - breakglass：应急令牌（GitHub 不可用时的备用登录）
 */
export type AuthMethod = "github" | "breakglass";

/**
 * 危险操作「二次确认」的有效期：距上次强认证（authAt）超过该秒数即要求重新认证。
 * 见 hasFreshAuth。
 */
export const STEP_UP_WINDOW_SECONDS = 5 * 60;

/** 会话撤销版本号所存储的环境变量键；修改认证信息时 +1，旧会话立即失效 */
const TOKEN_VER_KEY = "ADMIN_TOKEN_VER";

let cachedSecret: string | null = null;

/**
 * 当前会话令牌版本号：读取 .env.local 的 ADMIN_TOKEN_VER（文件优先实时，
 * 保证改钥后同进程内旧令牌立即失效）；未配置视为 0。
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
	/** 会话撤销版本号：与 .env.local 的 ADMIN_TOKEN_VER 一致才有效 */
	ver: string;
	/** 会话 ID：对应服务端会话表中的记录（被踢下线后此 ID 失效） */
	sid: string;
	/** 上次强认证时间（epoch 秒）：危险操作二次确认据此判定是否需重新认证 */
	authAt: number;
	/** 本会话的认证方式 */
	amr: AuthMethod;
	/**
	 * 有效账户名：由 verifySessionToken 在验签后从服务端会话表补全，
	 * 不是令牌内容——令牌即使携带该字段也以会话表为准（审计用）。
	 */
	username?: string;
	iat: number;
	exp: number;
}

export function generateSessionToken(
	maxAgeSeconds = SESSION_MAX_AGE,
	sid?: string,
	authAt?: number,
	amr: AuthMethod = "github",
): string {
	const now = Math.floor(Date.now() / 1000);
	const payload: JwtPayload = {
		sub: crypto.randomUUID(),
		ver: getTokenVersion(),
		sid: sid || crypto.randomUUID(),
		authAt: authAt ?? now,
		amr,
		iat: now,
		exp: now + maxAgeSeconds,
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

		// 撤销广播：令牌签发时的版本号必须与当前一致（改钥后旧会话立即失效）
		if (payload.ver !== getTokenVersion()) {
			return null;
		}

		// 会话表检查：sid 必须存在且未过期（被「踢下线」后此校验即失败）
		// 无 sid 的旧令牌（升级前签发）一律视为无效，强制重新登录以登记会话
		if (!payload.sid) return null;
		const session = await getSession(payload.sid);
		if (!session) return null;

		// 有效账户名以服务端会话表为准（审计需要，令牌本身不含该字段）
		payload.username = session.username;

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
 * 危险操作的「二次确认」：距上次强认证是否足够新鲜。
 * 登录（含 GitHub OAuth）后 5 分钟内视为新鲜；超时则要求重新认证。
 */
export function hasFreshAuth(payload: JwtPayload | undefined): boolean {
	if (!payload) return false;
	const now = Math.floor(Date.now() / 1000);
	return now - payload.authAt <= STEP_UP_WINDOW_SECONDS;
}

/** 危险操作需要重新认证时返回的标准 403（前端据此触发重新登录） */
export function stepUpRequiredResponse(): Response {
	return new Response(
		JSON.stringify({
			success: false,
			code: "STEP_UP_REQUIRED",
			message: "该操作需要重新验证身份，请重新登录后再试",
		}),
		{ status: 403, headers: { "Content-Type": "application/json" } },
	);
}

/**
 * 校验应急令牌（break-glass）：对比 ADMIN_BREAKGLASS_TOKEN。
 * 使用 timingSafeEqual 防时序攻击；未配置时一律返回 false（备用入口关闭）。
 */
export function verifyBreakglassToken(input: string): boolean {
	try {
		if (!input) return false;
		const expected = readSecretValue("ADMIN_BREAKGLASS_TOKEN");
		if (!expected) return false;
		const a = Buffer.from(input);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return crypto.timingSafeEqual(a, b);
	} catch (error) {
		console.error(
			"[Auth] 应急令牌校验异常:",
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}

/** 应急令牌是否已配置（未配置则登录页不展示备用入口） */
export function isBreakglassConfigured(): boolean {
	try {
		return readSecretValue("ADMIN_BREAKGLASS_TOKEN") !== "";
	} catch {
		return false;
	}
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
