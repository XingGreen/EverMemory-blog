import {
	clearAuthCookie,
	generateSessionToken,
	REMEMBER_MAX_AGE,
	SESSION_MAX_AGE,
	setAuthCookie,
	verifyAdminPassword,
	verifyAdminUsername,
} from "@/utils/auth";
import {
	checkAttemptRate,
	checkLockout,
	clearAttempts,
	clearFailures,
	failureCount,
	getClientIp,
	registerAttempt,
	registerFailure,
	writeAuditLog,
} from "@/utils/login-guard";
import { registerSession } from "@/utils/session-store";
import { verifyTurnstileToken } from "@/utils/turnstile";

export const prerender = false;

/** 标准 Retry-After（秒）。客户端可据此禁用按钮并倒计时，无需解析中文文案 */
function retryAfterHeader(base: Headers, seconds: number): Headers {
	const value = Math.max(1, Math.ceil(seconds));
	base.set("Retry-After", String(value));
	return base;
}

/** 锁定态响应的完整头集合 */
function lockedHeaders(seconds: number): Headers {
	return retryAfterHeader(
		new Headers({ "Content-Type": "application/json" }),
		seconds,
	);
}

export async function POST({ request }) {
	try {
		const text = await request.text();
		const body = JSON.parse(text);
		const { username, password, rememberMe, turnstileToken } = body;
		const clientKey = getClientIp(request);

		// 人机验证置于所有闸门之前：验证码本身有成本，能显著削减后续
		// scrypt 的调用量，不必等通过频次闸门之后才拦
		const turnstile = await verifyTurnstileToken(
			typeof turnstileToken === "string" ? turnstileToken : "",
			clientKey === "unknown" ? undefined : clientKey,
		);
		if (!turnstile.ok) {
			console.warn(`[Admin Verify] Turnstile rejected: ${turnstile.reason}`);
			writeAuditLog({
				event: "login_failure",
				client: clientKey,
				username,
				detail: `turnstile: ${turnstile.reason}`,
			});
			return new Response(
				JSON.stringify({
					success: false,
					message: "人机验证未通过，请重试",
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		// 参数完整性检查
		const missing: string[] = [];
		if (!username) missing.push("用户名");
		if (!password) missing.push("密码");

		if (missing.length > 0) {
			console.log(`[Admin Verify] Failed: missing ${missing.join(", ")}`);
			return new Response(
				JSON.stringify({
					success: false,
					message: `缺少: ${missing.join("、")}`,
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		// 频次闸门（与成败无关）：先于锁定检查，二者独立生效
		const { limited, retryAfterSeconds } = await checkAttemptRate(clientKey);
		if (limited) {
			writeAuditLog({
				event: "login_locked",
				client: clientKey,
				username,
				detail: `rate limited for ${retryAfterSeconds}s`,
			});
			return new Response(
				JSON.stringify({
					success: false,
					message: `尝试过于频繁，请 ${retryAfterSeconds} 秒后重试`,
				}),
				{ status: 429, headers: lockedHeaders(retryAfterSeconds) },
			);
		}

		// 暴力破解防护：连续失败达到阈值后锁定该客户端
		const { locked, retryAfterSeconds: lockRetryAfterSeconds } =
			await checkLockout(clientKey);
		if (locked) {
			writeAuditLog({
				event: "login_locked",
				client: clientKey,
				username,
				detail: `locked for ${lockRetryAfterSeconds}s`,
			});
			return new Response(
				JSON.stringify({
					success: false,
					message: `尝试过于频繁，请 ${lockRetryAfterSeconds} 秒后重试`,
				}),
				{ status: 429, headers: lockedHeaders(lockRetryAfterSeconds) },
			);
		}

		// 通过闸门后才计数：被拒的请求不应把窗口无限往后推
		await registerAttempt(clientKey);

		// 双重验证：用户名 + 密码，全部通过才签发会话
		// 私钥由服务端环境变量持有，用于 GitHub API 操作，前端不传输
		// 两个校验都无条件执行（不短路）：否则用户名错误时会跳过耗时的
		// scrypt，成为可测量的时序侧信道来枚举有效用户名
		const usernameOk = verifyAdminUsername(username);
		const passwordOk = verifyAdminPassword(password);

		if (usernameOk && passwordOk) {
			await clearFailures(clientKey);
			await clearAttempts(clientKey);
			writeAuditLog({
				event: "login_success",
				client: clientKey,
				username,
			});
			// 勾选"记住我"：签发 7 天令牌并写入 7 天 Cookie；否则保持 1 小时会话
			const maxAge = rememberMe ? REMEMBER_MAX_AGE : SESSION_MAX_AGE;
			// 注册服务端会话（登记设备/IP/时间，供会话管理页查看与踢下线）
			const sid = await registerSession({
				username,
				ua: request.headers.get("user-agent") || "",
				ip: clientKey,
				maxAgeSeconds: maxAge,
				remember: rememberMe,
			});
			const token = generateSessionToken(maxAge, sid);
			const headers = new Headers({ "Content-Type": "application/json" });
			setAuthCookie(token, headers, maxAge);

			return new Response(
				JSON.stringify({
					success: true,
					message: "验证成功",
				}),
				{ status: 200, headers },
			);
		}

		// 至少一项失败：统一提示（不泄露哪一项失败），并累计锁定
		const lockInfo = await registerFailure(clientKey);
		const failures = await failureCount(clientKey);
		writeAuditLog({
			event: "login_failure",
			client: clientKey,
			username,
			detail: lockInfo.locked
				? `locked for ${lockInfo.retryAfterSeconds}s`
				: `failures=${failures}`,
		});
		const failHeaders = new Headers({ "Content-Type": "application/json" });
		clearAuthCookie(failHeaders);

		// 本次失败恰好跨过阈值：按 429 返回而非 401。若沿用 401，客户端无法
		// 得知已被锁定，会把「需要等待」误当成「凭据错误」继续重试。
		if (lockInfo.locked) {
			return new Response(
				JSON.stringify({
					success: false,
					message: `尝试过于频繁，请 ${lockInfo.retryAfterSeconds} 秒后重试`,
				}),
				{
					status: 429,
					headers: retryAfterHeader(failHeaders, lockInfo.retryAfterSeconds),
				},
			);
		}

		return new Response(
			JSON.stringify({ success: false, message: "用户名或密码错误" }),
			{ status: 401, headers: failHeaders },
		);
	} catch (error) {
		console.error(
			"[Admin Verify] Exception:",
			error instanceof Error ? error.stack : error,
		);
		const failHeaders = new Headers({ "Content-Type": "application/json" });
		clearAuthCookie(failHeaders);

		return new Response(
			JSON.stringify({
				success: false,
				message: "验证失败",
			}),
			{ status: 500, headers: failHeaders },
		);
	}
}

export async function DELETE() {
	const headers = new Headers({ "Content-Type": "application/json" });
	clearAuthCookie(headers);
	return new Response(JSON.stringify({ success: true }), {
		status: 200,
		headers,
	});
}
