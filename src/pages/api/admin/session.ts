import { getAuthTokenFromRequest, verifySessionToken } from "@/utils/auth";
import { isBreakglassConfigured } from "@/utils/auth";
import { isOAuthConfigured } from "@/utils/github-oauth";

export const prerender = false;

// 会话校验：供前端判断会话 Cookie 是否仍有效（免登录进入后台）。
// 已登录时回传当前账户名（侧边栏用户卡片显示），走会话表实时值。
// oauthEnabled / breakglassEnabled 与登录态无关，始终回传，供登录页决定渲染哪些入口。
export async function GET({ request }) {
	const token = getAuthTokenFromRequest(request);
	const payload = token ? await verifySessionToken(token) : null;

	const body: {
		success: boolean;
		username?: string;
		oauthEnabled: boolean;
		breakglassEnabled: boolean;
	} = {
		success: Boolean(payload),
		oauthEnabled: isOAuthConfigured(),
		breakglassEnabled: isBreakglassConfigured(),
	};
	if (payload) {
		body.username = payload.username || "admin";
	}

	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
