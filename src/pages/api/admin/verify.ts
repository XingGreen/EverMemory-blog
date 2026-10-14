import {
	clearAuthCookie,
	generateSessionToken,
	isSuperPasswordConfigured,
	REMEMBER_MAX_AGE,
	resolveLoginSpace,
	SESSION_MAX_AGE,
	SUPER_SESSION_MAX_AGE,
	setAuthCookie,
	verifyAdminPassword,
	verifyAdminUsername,
	verifySuperPassword,
} from "@/utils/auth";
import {
	checkAttemptRate,
	checkLockout,
	clearAttempts,
	clearFailures,
	failureCount,
	getClientIp,
	isIpBanned,
	registerAttempt,
	registerFailure,
	SUPER_SCOPE,
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

		// IP 黑名单：被人工封禁的客户端直接拒绝，置于一切闸门之前——
		// 连 Turnstile 与 scrypt 都不必跑，不为已知恶意来源继续付费
		const ban = await isIpBanned(clientKey);
		if (ban.banned) {
			writeAuditLog({
				event: "login_locked",
				client: clientKey,
				username,
				detail: `ip banned: ${ban.reason}`,
			});
			const banHeaders = new Headers({ "Content-Type": "application/json" });
			clearAuthCookie(banHeaders);
			if (ban.retryAfterSeconds > 0) {
				retryAfterHeader(banHeaders, ban.retryAfterSeconds);
			}
			return new Response(
				JSON.stringify({ success: false, message: "访问被拒绝" }),
				{ status: 403, headers: banHeaders },
			);
		}

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

		// 三路校验全部无条件执行（不短路）：
		// - 用户名错误时不跳过耗时 scrypt，避免用响应时间枚举有效用户名；
		// - 主密码与第二密码都算一遍，避免用响应时间区分「主密码对」还是
		//   「第二密码对」（计划 §P0.2；代价是每次登录最多 2 次 scrypt）。
		// 私钥由服务端环境变量持有，用于 GitHub API 操作，前端不传输。
		const usernameOk = verifyAdminUsername(username);
		const passwordOk = verifyAdminPassword(password);
		const superConfigured = isSuperPasswordConfigured();
		const superChecked = verifySuperPassword(password);

		// 第二密码此前失败过多被锁：本次一律判不通过。
		// 只锁 super 空间——主密码仍可正常进入主空间，攻击者无法靠刷第二
		// 密码失败把整个后台锁死（代价是窗口内应急控制台不可用，由 CLI /
		// 平台层兜底）。
		const superLocked = superConfigured
			? (await checkLockout(clientKey, SUPER_SCOPE)).locked
			: false;
		const superOk = superChecked && !superLocked;

		// 分空间判定（主密码优先）由纯函数承载，规则单测覆盖。
		const role = resolveLoginSpace({
			usernameOk,
			passwordOk,
			superConfigured,
			superOk,
		});
		const isSuper = role === "super";

		if (role) {
			// 成功只清空「本空间」的失败计数：主密码成功不清零第二密码的
			// 失败计数，否则攻击者可用正确主密码登录来重置探测额度。
			await clearFailures(clientKey, isSuper ? SUPER_SCOPE : undefined);
			await clearAttempts(clientKey);
			writeAuditLog({
				event: "login_success",
				client: clientKey,
				username,
				detail: `space=${role}`,
			});
			// 第二空间（应急控制台）固定 1 小时、不提供「记住我」（Q8）；
			// 主空间沿用勾选结果（7 天 / 12 小时）。
			const maxAge = isSuper
				? SUPER_SESSION_MAX_AGE
				: rememberMe
					? REMEMBER_MAX_AGE
					: SESSION_MAX_AGE;
			// 注册服务端会话（登记设备/IP/时间，供会话管理页查看与踢下线）
			const sid = await registerSession({
				username,
				ua: request.headers.get("user-agent") || "",
				ip: clientKey,
				maxAgeSeconds: maxAge,
				remember: isSuper ? false : Boolean(rememberMe),
				role,
			});
			const token = generateSessionToken(maxAge, sid, role);
			const headers = new Headers({ "Content-Type": "application/json" });
			setAuthCookie(token, headers, maxAge);

			return new Response(
				JSON.stringify({
					success: true,
					message: "验证成功",
					space: role,
				}),
				{ status: 200, headers },
			);
		}

		// 至少一项失败：统一提示（不泄露哪一项失败），并累计锁定。
		// 失败同时记入主空间与 super 两个计数器：一次猜错等于同时猜错两个
		// 密码，两侧都应消耗额度。
		const lockInfo = await registerFailure(clientKey);
		await registerFailure(clientKey, SUPER_SCOPE);
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
