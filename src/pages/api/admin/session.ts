import {
	getAuthTokenFromRequest,
	isBreakglassConfigured,
	isJwtSecretAvailable,
	verifySessionToken,
} from "@/utils/auth";
import { isOAuthConfigured } from "@/utils/github-oauth";
import { isKvBackend } from "@/utils/persist-store";
import { isSessionStoreDegraded } from "@/utils/session-store";

export const prerender = false;

// 会话校验：供前端判断会话 Cookie 是否仍有效（免登录进入后台）。
// 已登录时回传当前账户名（侧边栏用户卡片显示），走会话表实时值。
// oauthEnabled / breakglassEnabled 与登录态无关，始终回传，供登录页决定渲染哪些入口。
// storage 字段告知前端当前持久化后端与降级状态，供后台展示「降级模式」提示。
export async function GET({ request }) {
	/* 签名密钥不可用时不进验签：否则每个请求都得到「令牌无效」，
	   前端被当成未登录反复弹回登录页，真正的原因（缺环境变量）永远不会显示。 */
	const secretAvailable = isJwtSecretAvailable();

	const token = secretAvailable ? getAuthTokenFromRequest(request) : null;
	const payload = token ? await verifySessionToken(token) : null;

	const body: {
		success: boolean;
		username?: string;
		/** 服务端配置错误：前端据此显示原因，而不是跳回登录页 */
		configError?: string;
		oauthEnabled: boolean;
		breakglassEnabled: boolean;
		storage: {
			backend: "file" | "kv";
			/** KV 熔断中：会话表不可用，已降级为仅 JWT 校验 */
			degraded: boolean;
		};
	} = {
		success: Boolean(payload),
		oauthEnabled: isOAuthConfigured(),
		breakglassEnabled: isBreakglassConfigured(),
		storage: {
			backend: isKvBackend() ? "kv" : "file",
			degraded: isSessionStoreDegraded(),
		},
	};
	if (payload) {
		body.username = payload.username || "admin";
	} else if (!secretAvailable) {
		body.configError =
			"服务器缺少 ADMIN_JWT_SECRET，无法校验登录状态。请在部署平台配置该环境变量（32 字节以上随机串）后重新部署。";
	}

	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
