import type { APIRoute } from "astro";

import {
	type AuthMethod,
	generateSessionToken,
	REMEMBER_MAX_AGE,
	setAuthCookie,
} from "@/utils/auth";
import { getClientIp } from "@/utils/client-ip";
import { resolveRedirectUri } from "@/utils/github-oauth";
import {
	clearTransactionCookie,
	GITHUB_OAUTH_TX_COOKIE,
	parseTransaction,
} from "@/utils/providers/auth/github-oauth";
import { getAuthProvider } from "@/utils/providers/registry";
import { describeDevice, registerSession } from "@/utils/session-store";

export const prerender = false;

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

/** Login failed: clear the transaction cookie and return to the login page. */
function fail(reason: string): Response {
	const headers = new Headers();
	headers.set("Set-Cookie", clearTransactionCookie());
	headers.set("Location", `/login/?oauth_error=${encodeURIComponent(reason)}`);
	return new Response(null, { status: 302, headers });
}

export const GET: APIRoute = async ({ request }) => {
	const provider = getAuthProvider();
	if (!provider?.completeLogin) return fail("oauth_disabled");

	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	const tx = parseTransaction(readCookie(request, GITHUB_OAUTH_TX_COOKIE));
	if (!tx) return fail("state_missing");
	if (!state || state !== tx.state) return fail("state_mismatch");
	if (!code) return fail("code_missing");

	const redirectUri = tx.redirectUri || resolveRedirectUri(request);
	const result = await provider.completeLogin({
		request,
		code,
		redirectUri,
		verifier: tx.verifier,
	});
	if (!result.ok) return fail(result.error);

	// The login method is recorded for audit only; it never changes permissions.
	const amr: AuthMethod = provider.kind === "token" ? "breakglass" : "github";
	const username = result.identity.login || "admin";
	const maxAge = REMEMBER_MAX_AGE;
	const sid = await registerSession({
		username,
		ua: request.headers.get("user-agent") || "",
		ip: getClientIp(request),
		maxAgeSeconds: maxAge,
		remember: true,
		amr,
	});
	const nowSeconds = Math.floor(Date.now() / 1000);
	const sessionToken = generateSessionToken(maxAge, sid, nowSeconds, amr);

	const headers = new Headers();
	setAuthCookie(sessionToken, headers, maxAge);
	// One-shot transaction cookie: clear it on the success path too.
	headers.append("Set-Cookie", clearTransactionCookie());

	const dest =
		tx.next && /^\/admin(\/|$)/.test(tx.next) ? tx.next : "/admin/";
	headers.set("Location", dest);
	console.log(
		`[Admin Auth] 登录成功 · provider=${provider.id} · user=${username} · id=${result.identity.id} · device=${describeDevice(request.headers.get("user-agent") || "")}`,
	);
	return new Response(null, { status: 302, headers });
};
