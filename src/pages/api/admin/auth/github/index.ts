import type { APIRoute } from "astro";

import { getAuthProvider } from "@/utils/providers/registry";

export const prerender = false;

/** Only allow same-site redirects to /admin, which rules out open redirects. */
function sanitizeNext(raw: string | null): string {
	if (raw && /^\/admin(\/|$)/.test(raw)) return raw;
	return "/admin/";
}

function unavailable(message: string): Response {
	return new Response(message, {
		status: 503,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

// Start a login: the provider builds the authorize URL and the transaction cookie.
// `force=1` asks the provider to re-prompt for credentials (step-up confirmation).
export const GET: APIRoute = async ({ request }) => {
	const provider = getAuthProvider();
	if (!provider?.beginLogin) return unavailable("未配置登录方式");

	const url = new URL(request.url);
	const force = url.searchParams.get("force") === "1";
	const next = sanitizeNext(url.searchParams.get("next"));

	const result = await provider.beginLogin({
		request,
		next,
		forceLogin: force,
	});
	if (!result) return unavailable("登录方式未配置完整");

	const headers = new Headers();
	if (result.transactionCookie) {
		headers.append("Set-Cookie", result.transactionCookie);
	}
	headers.set("Location", result.url);
	return new Response(null, { status: 302, headers });
};
