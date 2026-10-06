/**
 * Cloudflare Turnstile 人机验证（服务端侧，仅登录接口使用）
 *
 * 定位：这是 IP 频次闸门之上的第二道锁，用于打断「自动化脚本批量尝试」。
 * 频次闸门只能把速率压到人类水平，Turnstile 能让脚本根本拿不到凭据。
 *
 * 启用判定：site key 与 secret key **成对存在**才启用。只配一个属于配置错误，
 * 此时按「拒绝」而非「跳过」处理——若放行，前端会渲染出看似有效的验证码，
 * 后端却根本不校验，形成一种虚假的安全感，比没有验证码更危险。
 *
 * 未配置（两个都没有）时整体跳过校验，因此该功能对既有部署完全向后兼容：
 * 不配置就不会改变任何登录行为。
 */

import { getEnv } from "./env";

/** Cloudflare 的站点校验端点 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** 校验请求超时（毫秒）。挂起会让登录接口被拖住，故必须设上限 */
const VERIFY_TIMEOUT_MS = 5000;

export interface TurnstileConfig {
	/** 是否启用校验：两个 key 都在才启用 */
	enabled: boolean;
	/** 前端渲染 widget 用的公开 site key（本身就是公开信息） */
	siteKey: string;
	/**
	 * 配置不完整：只配了其中一个 key。
	 * 此时必须拒绝登录，且需要在服务端留痕以便排查。
	 */
	incomplete: boolean;
}

/** 读取当前 Turnstile 配置 */
export function getTurnstileConfig(): TurnstileConfig {
	const siteKey = getEnv("TURNSTILE_SITE_KEY").trim();
	const secretKey = getEnv("TURNSTILE_SECRET_KEY").trim();
	const hasSite = siteKey.length > 0;
	const hasSecret = secretKey.length > 0;
	return {
		enabled: hasSite && hasSecret,
		siteKey,
		incomplete: hasSite !== hasSecret,
	};
}

export interface TurnstileResult {
	/** 是否放行 */
	ok: boolean;
	/** 是否因未启用而跳过校验（跳过即放行） */
	skipped: boolean;
	/** 拒绝原因，仅用于服务端日志，不透传给客户端 */
	reason: string;
}

const SKIPPED: TurnstileResult = { ok: true, skipped: true, reason: "" };

/**
 * 校验客户端提交的 Turnstile token。
 *
 * 失败一律拒绝（fail closed）：包括配置不完整、网络异常、返回非 JSON 等情况。
 * 只有「功能未启用」才放行，因为那是可预期且显式的部署选择。
 *
 * @param token 客户端 widget 回调给出的 token
 * @param remoteip 客户端 IP，一并上报供 Cloudflare 风控使用
 */
export async function verifyTurnstileToken(
	token: string,
	remoteip?: string,
): Promise<TurnstileResult> {
	const { enabled, incomplete } = getTurnstileConfig();
	if (incomplete) {
		return {
			ok: false,
			skipped: false,
			reason: "TURNSTILE_INCOMPLETE_CONFIG",
		};
	}
	if (!enabled) return SKIPPED;

	if (!token) {
		return { ok: false, skipped: false, reason: "TURNSTILE_MISSING_TOKEN" };
	}

	const secretKey = getEnv("TURNSTILE_SECRET_KEY").trim();
	const body = new URLSearchParams({ secret: secretKey, response: token });
	if (remoteip) body.set("remoteip", remoteip);

	let payload: TurnstileVerifyResponse;
	try {
		const res = await fetch(SITEVERIFY_URL, {
			method: "POST",
			body,
			signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
		});
		if (!res.ok) {
			return {
				ok: false,
				skipped: false,
				reason: `TURNSTILE_HTTP_${res.status}`,
			};
		}
		payload = (await res.json()) as TurnstileVerifyResponse;
	} catch (error) {
		return {
			ok: false,
			skipped: false,
			reason: `TURNSTILE_REQUEST_FAILED: ${errorText(error)}`,
		};
	}

	if (payload?.success === true) return { ok: true, skipped: false, reason: "" };

	const codes = payload?.["error-codes"];
	const detail = Array.isArray(codes) && codes.length > 0 ? codes.join(",") : "unknown";
	return { ok: false, skipped: false, reason: `TURNSTILE_REJECTED: ${detail}` };
}

interface TurnstileVerifyResponse {
	success?: boolean;
	"error-codes"?: string[];
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}