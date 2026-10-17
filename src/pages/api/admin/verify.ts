import { sendLoginAlert } from "@/utils/alert";
import { writeAuditLog } from "@/utils/audit-log";
import {
	clearAuthCookie,
	generateSessionToken,
	isBreakglassConfigured,
	SESSION_MAX_AGE,
	setAuthCookie,
	verifyBreakglassToken,
} from "@/utils/auth";
import { getClientIp } from "@/utils/client-ip";
import { describeDevice, registerSession } from "@/utils/session-store";
import { verifyTurnstileToken } from "@/utils/turnstile";

export const prerender = false;

const json = (body: unknown, status: number, extraHeaders?: Headers) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...(extraHeaders ? Object.fromEntries(extraHeaders) : {}),
		},
	});

// 备用登录（break-glass）：GitHub OAuth 不可用时用 ADMIN_BREAKGLASS_TOKEN 登录。
// token 为高熵随机串（256 位），不可暴力破解，只做一次常数时间比对，故不设
// 失败锁定 / 频率限流（限流开销反而高于它保护的那次比较）。
export async function POST({ request }) {
	try {
		const body = await request.json();
		const { token, turnstileToken } = body;
		const clientKey = getClientIp(request);

		if (!isBreakglassConfigured()) {
			return json(
				{ success: false, message: "应急登录未启用，请使用 GitHub 登录" },
				400,
			);
		}

		// 人机验证：未配置 Turnstile 时为空操作（fail open），配置后 fail closed
		const turnstile = await verifyTurnstileToken(
			typeof turnstileToken === "string" ? turnstileToken : "",
			clientKey === "unknown" ? undefined : clientKey,
		);
		if (!turnstile.ok) {
			console.warn(`[Admin Verify] Turnstile rejected: ${turnstile.reason}`);
			writeAuditLog({
				event: "login_failure",
				client: clientKey,
				username: "admin",
				detail: `turnstile: ${turnstile.reason}`,
			});
			return json({ success: false, message: "人机验证未通过，请重试" }, 400);
		}

		if (typeof token !== "string" || !token) {
			return json({ success: false, message: "请输入应急登录令牌" }, 400);
		}

		if (!verifyBreakglassToken(token)) {
			writeAuditLog({
				event: "login_failure",
				client: clientKey,
				username: "admin",
				detail: "breakglass token mismatch",
			});
			const headers = new Headers();
			clearAuthCookie(headers);
			return json(
				{ success: false, message: "应急登录令牌无效" },
				401,
				headers,
			);
		}

		const sid = await registerSession({
			username: "admin",
			ua: request.headers.get("user-agent") || "",
			ip: clientKey,
			maxAgeSeconds: SESSION_MAX_AGE,
			remember: false,
			amr: "breakglass",
		});
		const authToken = generateSessionToken(
			SESSION_MAX_AGE,
			sid,
			undefined,
			"breakglass",
		);
		const headers = new Headers();
		setAuthCookie(authToken, headers, SESSION_MAX_AGE);

		writeAuditLog({
			event: "login_success",
			client: clientKey,
			username: "admin",
			detail: "amr=breakglass",
		});

		await sendLoginAlert({
			username: "admin",
			ip: clientKey,
			device: describeDevice(request.headers.get("user-agent") || ""),
			time: new Date().toISOString(),
		});

		return json({ success: true, message: "验证成功" }, 200, headers);
	} catch (error) {
		console.error(
			"[Admin Verify] Exception:",
			error instanceof Error ? error.stack : error,
		);
		const headers = new Headers();
		clearAuthCookie(headers);
		return json({ success: false, message: "验证失败" }, 500, headers);
	}
}

export async function DELETE() {
	const headers = new Headers();
	clearAuthCookie(headers);
	return json({ success: true }, 200, headers);
}
