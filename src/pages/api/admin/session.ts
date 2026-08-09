import { getAuthTokenFromRequest, verifySessionToken } from "@/utils/auth";

export const prerender = false;

// 会话校验：供前端判断"记住我"Cookie 是否仍有效（免登录进入后台）
export async function GET({ request }) {
	const token = getAuthTokenFromRequest(request);
	const success = Boolean(token && verifySessionToken(token));
	return new Response(JSON.stringify({ success }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
