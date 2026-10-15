import type { APIRoute } from "astro";

import {
	buildAuthorizeUrl,
	generatePkce,
	generateState,
	getOAuthConfig,
	resolveRedirectUri,
} from "@/utils/github-oauth";

export const prerender = false;

/** 一次性事务 cookie：承载 state / PKCE verifier / 回跳目标，10 分钟内有效 */
const OAUTH_TX_COOKIE = "admin_oauth_tx";
const OAUTH_TX_MAX_AGE = 600;

interface OAuthTx {
	state: string;
	verifier: string;
	next: string;
	redirectUri: string;
}

/** 只允许回跳到站内 /admin 路径，杜绝开放重定向 */
function sanitizeNext(raw: string | null): string {
	if (raw && /^\/admin(\/|$)/.test(raw)) return raw;
	return "/admin/dashboard/";
}

// 发起 OAuth：生成 state + PKCE 写入事务 cookie，随后 302 到 GitHub 授权页。
// force=1 时为「危险操作重新确认」：附加 prompt=login 强制重输 GitHub 凭据。
export const GET: APIRoute = ({ request }) => {
	const config = getOAuthConfig();
	if (!config) {
		return new Response("GitHub OAuth 未配置", {
			status: 503,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}

	const url = new URL(request.url);
	const force = url.searchParams.get("force") === "1";
	const next = sanitizeNext(url.searchParams.get("next"));
	const { verifier, challenge } = generatePkce();
	const state = generateState();
	const redirectUri = resolveRedirectUri(request);

	const tx: OAuthTx = { state, verifier, next, redirectUri };
	const headers = new Headers();
	headers.append(
		"Set-Cookie",
		`${OAUTH_TX_COOKIE}=${encodeURIComponent(JSON.stringify(tx))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${OAUTH_TX_MAX_AGE}`,
	);
	headers.set(
		"Location",
		buildAuthorizeUrl({
			clientId: config.clientId,
			redirectUri,
			state,
			challenge,
			forceLogin: force,
		}),
	);
	return new Response(null, { status: 302, headers });
};
