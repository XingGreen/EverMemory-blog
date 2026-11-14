import {
	getAuthTokenFromRequest,
	isBreakglassConfigured,
	verifySessionToken,
} from "@/utils/auth";
import { canBootstrap } from "@/utils/bootstrap-mode";
import { isOAuthConfigured } from "@/utils/github-oauth";
import { isKvBackend } from "@/utils/persist-store";
import { isSessionStoreDegraded } from "@/utils/session-store";

export const prerender = false;

// 会话校验：供前端判断会话 Cookie 是否仍有效（免登录进入后台）。
// 已登录时回传当前账户名（侧边栏用户卡片显示），走会话表实时值。
// oauthEnabled / breakglassEnabled 与登录态无关，始终回传，供登录页决定渲染哪些入口。
// storage 字段告知前端当前持久化后端与降级状态，供后台展示「降级模式」提示。
export async function GET({ request }) {
	const token = getAuthTokenFromRequest(request);
	const payload = token ? await verifySessionToken(token) : null;
	// 还没有任何会话、但密钥没配齐且来自本机：进入引导模式，让配置页能打开
	const bootstrap = !payload && canBootstrap(request);

	const body: {
		success: boolean;
		username?: string;
		/** 引导模式：尚未登录，正在完成首次配置 */
		bootstrap?: boolean;
		oauthEnabled: boolean;
		breakglassEnabled: boolean;
		storage: {
			backend: "file" | "kv";
			/** KV 熔断中：会话表不可用，已降级为仅 JWT 校验 */
			degraded: boolean;
		};
	} = {
		success: Boolean(payload) || bootstrap,
		oauthEnabled: isOAuthConfigured(),
		breakglassEnabled: isBreakglassConfigured(),
		storage: {
			backend: isKvBackend() ? "kv" : "file",
			degraded: isSessionStoreDegraded(),
		},
	};
	if (payload) {
		body.username = payload.username || "admin";
	} else if (bootstrap) {
		body.username = "初始化";
		body.bootstrap = true;
	}

	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
