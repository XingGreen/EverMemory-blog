/**
 * GitHub OAuth（user-to-server）登录流程（仅服务端使用）。
 *
 * 复用项目已有的 GitHub App：用它的 Client ID / Client Secret 走标准
 * Authorization Code 流程，拿到 user-to-server token 后调用 GET /user 取身份，
 * 用数字 id（永不变更）比对白名单。GitHub App 无需申请任何 scope。
 *
 * 安全要点：
 *  - state 防 CSRF：发起时随机生成并写入一次性 httpOnly cookie，回调时严格比对。
 *  - PKCE（S256）：即便回调被截获，无 code_verifier 也无法换取 token。
 *  - 白名单：只认 ADMIN_GITHUB_ID，其它 GitHub 账号一律拒绝。
 *
 * 依赖 node:crypto 与密钥读取（secret-io），仅可在服务端 import。
 */
import crypto from "node:crypto";

import { readSecretValue } from "@/utils/secret-io";

const AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";
const FETCH_TIMEOUT_MS = 8000;

/** OAuth 回调固定路径（须与 GitHub App 中登记的 Callback URL 一致） */
export const OAUTH_CALLBACK_PATH = "/api/admin/auth/github/callback";

export interface GitHubOAuthConfig {
	clientId: string;
	clientSecret: string;
	/** 允许登录的 GitHub 账号数字 id（单一管理员白名单） */
	authorizedUserId: string;
}

/**
 * 读取 OAuth 配置；任一必需项缺失即返回 null（视为功能未启用）。
 * 走 readSecretValue 以便同时支持 .env.local（实时）与平台环境变量。
 */
export function getOAuthConfig(): GitHubOAuthConfig | null {
	try {
		const clientId = readSecretValue("GITHUB_APP_CLIENT_ID");
		const clientSecret = readSecretValue("GITHUB_APP_CLIENT_SECRET");
		const authorizedUserId = readSecretValue("ADMIN_GITHUB_ID").trim();
		if (!clientId || !clientSecret || !authorizedUserId) return null;
		return { clientId, clientSecret, authorizedUserId };
	} catch {
		return null;
	}
}

/** OAuth 登录是否已配置（决定登录页是否渲染「使用 GitHub 登录」） */
export function isOAuthConfigured(): boolean {
	return getOAuthConfig() !== null;
}

/** 生成 PKCE 的 code_verifier 与 S256 code_challenge */
export function generatePkce(): { verifier: string; challenge: string } {
	const verifier = crypto.randomBytes(32).toString("base64url");
	const challenge = crypto
		.createHash("sha256")
		.update(verifier)
		.digest("base64url");
	return { verifier, challenge };
}

/** 生成随机 state（防 CSRF） */
export function generateState(): string {
	return crypto.randomBytes(32).toString("base64url");
}

/**
 * 解析回调地址：
 *  - 优先 GITHUB_OAUTH_REDIRECT_URI（部署时定死，适配反代/自定义域名）；
 *  - 否则按当前请求的 origin 推导（自托管开箱即用）。
 * 必须与 GitHub App 登记的 Callback URL 完全一致，否则 GitHub 拒绝回调。
 */
export function resolveRedirectUri(request: Request): string {
	const fromEnv = readSecretValue("GITHUB_OAUTH_REDIRECT_URI");
	if (fromEnv) return fromEnv;
	const origin = new URL(request.url).origin;
	return `${origin}${OAUTH_CALLBACK_PATH}`;
}

/** 组装 GitHub 授权页 URL */
export function buildAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	state: string;
	challenge: string;
	/** 危险操作二次确认：true 时附加 prompt=login，强制重新输入 GitHub 凭据（含 2FA） */
	forceLogin?: boolean;
}): string {
	const url = new URL(AUTHORIZE_ENDPOINT);
	url.searchParams.set("client_id", params.clientId);
	url.searchParams.set("redirect_uri", params.redirectUri);
	url.searchParams.set("state", params.state);
	url.searchParams.set("code_challenge", params.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	if (params.forceLogin) url.searchParams.set("prompt", "login");
	return url.toString();
}

export interface GitHubIdentity {
	/** 数字 id 的字符串形式（稳定标识，不随改名变化） */
	id: string;
	login: string;
	avatarUrl: string;
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/** 用授权码换取 access token；失败返回 null（绝不抛出） */
export async function exchangeCodeForToken(params: {
	clientId: string;
	clientSecret: string;
	code: string;
	redirectUri: string;
	verifier: string;
}): Promise<string | null> {
	try {
		const res = await fetchWithTimeout(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				client_id: params.clientId,
				client_secret: params.clientSecret,
				code: params.code,
				redirect_uri: params.redirectUri,
				code_verifier: params.verifier,
			}),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			access_token?: string;
			error?: string;
		};
		return data.access_token || null;
	} catch {
		return null;
	}
}

/** 用 access token 拉取 GitHub 用户身份；失败返回 null（绝不抛出） */
export async function fetchGitHubIdentity(
	token: string,
): Promise<GitHubIdentity | null> {
	try {
		const res = await fetchWithTimeout(USER_ENDPOINT, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "EverMemory-Blog-Admin",
			},
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			id?: number;
			login?: string;
			avatar_url?: string;
		};
		if (typeof data.id !== "number") return null;
		return {
			id: String(data.id),
			login: data.login || "",
			avatarUrl: data.avatar_url || "",
		};
	} catch {
		return null;
	}
}

/** 白名单校验：仅放行配置的管理员 GitHub id（常数时间比对） */
export function isAuthorizedIdentity(
	identity: GitHubIdentity,
	config: GitHubOAuthConfig,
): boolean {
	const expected = config.authorizedUserId.trim();
	if (!expected) return false;
	const actual = Buffer.from(identity.id, "utf8");
	const want = Buffer.from(expected, "utf8");
	if (actual.length !== want.length) return false;
	return crypto.timingSafeEqual(actual, want);
}
