import {
	getAuthTokenFromRequest,
	isSuperPasswordConfigured,
	verifySessionToken,
} from "@/utils/auth";
import { readSecretValue } from "@/utils/secret-io";

export const prerender = false;

// 会话校验：供前端判断"记住我"Cookie 是否仍有效（免登录进入后台）。
// 已登录时回传当前管理员用户名（侧边栏用户卡片显示），走 readSecretValue
// 以实时反映 .env.local 的 ADMIN_USERNAME；未登录不返回，避免泄露用户名。
// 同时回传 role（区分主空间/应急控制台）与 superConfigured（是否已配置第二密码），
// 供前端决定是否渲染控制面入口；服务端仍会在控制面 API 二次校验 role。
export async function GET({ request }) {
	const token = getAuthTokenFromRequest(request);
	const payload = token ? await verifySessionToken(token) : null;

	const body: {
		success: boolean;
		username?: string;
		role?: string;
		superConfigured?: boolean;
	} = {
		success: Boolean(payload),
	};
	if (payload) {
		body.username = readSecretValue("ADMIN_USERNAME") || "admin";
		body.role = payload.role;
		body.superConfigured = isSuperPasswordConfigured();
	}

	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
