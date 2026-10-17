import type { APIRoute } from "astro";

import {
	generateSessionToken,
	REMEMBER_MAX_AGE,
	setAuthCookie,
} from "@/utils/auth";
import { getClientIp } from "@/utils/client-ip";
import {
	exchangeCodeForToken,
	fetchGitHubIdentity,
	getOAuthConfig,
	isAuthorizedIdentity,
	resolveRedirectUri,
} from "@/utils/github-oauth";
import { describeDevice, registerSession } from "@/utils/session-store";

export const prerender = false;

const OAUTH_TX_COOKIE = "admin_oauth_tx";

interface OAuthTx {
	state: string;
	verifier: string;
	next: string;
	redirectUri: string;
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const idx = part.indexOf("=");
		if (idx === -1) continue;
		if (part.slice(0, idx).trim() === name) {
			return decodeURIComponent(part.slice(idx + 1).trim());
		}
	}
	return null;
}

function parseTx(request: Request): OAuthTx | null {
	const raw = readCookie(request, OAUTH_TX_COOKIE);
	if (!raw) return null;
	try {
		const tx = JSON.parse(raw) as OAuthTx;
		if (typeof tx.state !== "string" || typeof tx.verifier !== "string") {
			return null;
		}
		return tx;
	} catch {
		return null;
	}
}

const CLEAR_TX_COOKIE = `${OAUTH_TX_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/** 登录失败：清事务 cookie 并带错误码回到登录页（不回显任何敏感信息） */
function fail(reason: string): Response {
	const headers = new Headers();
	headers.set("Set-Cookie", CLEAR_TX_COOKIE);
	headers.set("Location", `/admin/?oauth_error=${encodeURIComponent(reason)}`);
	return new Response(null, { status: 302, headers });
}

export const GET: APIRoute = async ({ request }) => {
	const config = getOAuthConfig();
	if (!config) return fail("oauth_disabled");

	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	const tx = parseTx(request);
	if (!tx) return fail("state_missing");
	if (!state || state !== tx.state) return fail("state_mismatch");
	if (!code) return fail("code_missing");

	const redirectUri = tx.redirectUri || resolveRedirectUri(request);

	const token = await exchangeCodeForToken({
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		code,
		redirectUri,
		verifier: tx.verifier,
	});
	if (!token) return fail("token_exchange_failed");

	const identity = await fetchGitHubIdentity(token);
	if (!identity) return fail("identity_fetch_failed");

	// 白名单：非配置的管理员账号一律拒绝（不区分「账号不对」与「不是管理员」）
	if (!isAuthorizedIdentity(identity, config)) return fail("not_authorized");

	const username = identity.login || "admin";
	const ip = getClientIp(request);
	const maxAge = REMEMBER_MAX_AGE;
	const sid = await registerSession({
		username,
		ua: request.headers.get("user-agent") || "",
		ip,
		maxAgeSeconds: maxAge,
		remember: true,
		amr: "github",
	});
	const nowSeconds = Math.floor(Date.now() / 1000);
	const sessionToken = generateSessionToken(maxAge, sid, nowSeconds, "github");

	const headers = new Headers();
	setAuthCookie(sessionToken, headers, maxAge);
	// 事务 cookie 一次性：成功路径同样清除（set 之后再 append，两条 Set-Cookie 并存）
	headers.append("Set-Cookie", CLEAR_TX_COOKIE);

	const dest =
		tx.next && /^\/admin(\/|$)/.test(tx.next) ? tx.next : "/admin/dashboard/";
	headers.set("Location", dest);
	console.log(
		`[Admin OAuth] 登录成功 · user=${username} · id=${identity.id} · device=${describeDevice(request.headers.get("user-agent") || "")}`,
	);
	return new Response(null, { status: 302, headers });
};
