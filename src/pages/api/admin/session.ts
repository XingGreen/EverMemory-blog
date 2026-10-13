import { getAuthTokenFromRequest, verifySessionToken } from "@/utils/auth";
import { readSecretValue } from "@/utils/secret-io";

export const prerender = false;

// 会话校验：供前端判断"记住我"Cookie 是否仍有效（免登录进入后台）。
// 已登录时回传当前管理员用户名（侧边栏用户卡片显示），走 readSecretValue
// 以实时反映 .env.local 的 ADMIN_USERNAME；未登录不返回，避免泄露用户名。
export async function GET({ request }) {
	const token = getAuthTokenFromRequest(request);
	const payload = token ? await verifySessionToken(token) : null;

	const body: { success: boolean; username?: string } = {
		success: Boolean(payload),
	};
	if (payload) {
		body.username = readSecretValue("ADMIN_USERNAME") || "admin";
	}

	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
