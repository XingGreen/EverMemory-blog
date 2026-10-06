import { getTurnstileConfig } from "@/utils/turnstile";

export const prerender = false;

/**
 * 登录页需要知道「是否要渲染验证码」以及用哪个 site key。
 *
 * 该端点刻意不要求认证：site key 本质是公开信息（浏览器渲染 widget 时
 * 必须拿到它），而登录页尚未通过认证，用受保护端点会造成死循环。
 * 只返回 site key，绝不返回 secret key。
 */
export async function GET(): Promise<Response> {
	const { enabled, siteKey, incomplete } = getTurnstileConfig();
	return new Response(
		JSON.stringify({
			enabled,
			// 未配置时返回空串而非 null，前端只需判断 truthiness
			siteKey: enabled ? siteKey : "",
			// 配置不完整时前端照常渲染（让管理员看到真实状态），
			// 但服务端会拒绝提交，日志里也会留痕
			incomplete,
		}),
		{
			status: 200,
			headers: {
				"Content-Type": "application/json",
				// 配置在登录期间可能刚被改，避免浏览器缓存导致 widget 空白
				"Cache-Control": "no-store",
			},
		},
	);
}