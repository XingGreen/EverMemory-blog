import {
	generateSessionToken,
	SESSION_MAX_AGE,
	setAuthCookie,
} from "@/utils/auth";
import { getClientIp, writeAuditLog } from "@/utils/login-guard";
import { isEnvFileWritable } from "@/utils/secret-io";
import { registerSession } from "@/utils/session-store";
import {
	finishSetup,
	getSetupToken,
	isInitialized,
	verifySetupToken,
} from "@/utils/setup";

export const prerender = false;

function json(body: unknown, status = 200, extraHeaders?: Headers): Response {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (extraHeaders) {
		for (const [key, value] of extraHeaders) headers.set(key, value);
	}
	return new Response(JSON.stringify(body), { status, headers });
}

/** GET：返回初始化状态；未初始化时惰性生成安装令牌并通知前端 */
export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	if (isInitialized()) {
		return json({ success: true, initialized: true });
	}

	const writable = isEnvFileWritable();
	let origin: string | undefined;
	try {
		origin = new URL(request.url).origin;
	} catch {
		// 解析失败时日志回退到默认文案
	}
	return json({
		success: true,
		initialized: false,
		writable,
		tokenRequired: writable,
		defaultUsername: import.meta.env.ADMIN_USERNAME || "admin",
		// 未初始化时确保令牌已生成（打印到服务端日志供部署者获取）
		...(writable ? { tokenReady: Boolean(getSetupToken(origin)) } : {}),
	});
}

/** POST：校验安装令牌并完成初始化，成功后直接签发会话（免去首次再登录） */
export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	try {
		if (isInitialized()) {
			return json({ success: false, message: "已完成初始化，请直接登录" }, 409);
		}
		if (!isEnvFileWritable()) {
			return json(
				{
					success: false,
					message:
						"当前为只读部署环境，请在部署平台配置 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_JWT_SECRET 环境变量",
				},
				403,
			);
		}

		const body = (await request.json()) as {
			token?: string;
			username?: string;
			password?: string;
		};

		// 安装令牌校验
		if (!verifySetupToken(String(body.token || ""))) {
			return json({ success: false, message: "安装令牌无效或已过期" }, 401);
		}

		// 用户名校验
		if (typeof body.username !== "string" || !body.username.trim()) {
			return json({ success: false, message: "请填写管理员用户名" }, 400);
		}
		const username = body.username.trim().slice(0, 64);

		// 密码强度校验
		if (typeof body.password !== "string" || body.password.length < 8) {
			return json({ success: false, message: "密码至少需要 8 位" }, 400);
		}
		if (body.password.length > 128) {
			return json({ success: false, message: "密码长度不能超过 128 位" }, 400);
		}
		if (body.password === username) {
			return json({ success: false, message: "密码不能与用户名相同" }, 400);
		}

		// 写入 .env.local 并焚毁令牌
		finishSetup(username, body.password);
		writeAuditLog({
			event: "setup_completed",
			client: getClientIp(request),
			username,
			detail: "管理员账号初始化完成，安装令牌已焚毁",
		});

		// 直接签发会话 Cookie，让用户免登录进入控制台（同时登记服务端会话）
		const sid = await registerSession({
			username,
			ua: request.headers.get("user-agent") || "",
			ip: getClientIp(request),
			maxAgeSeconds: SESSION_MAX_AGE,
			remember: false,
		});
		const token = generateSessionToken(SESSION_MAX_AGE, sid);
		const headers = new Headers();
		setAuthCookie(token, headers, SESSION_MAX_AGE);

		return json(
			{
				success: true,
				message: "初始化完成，正在进入控制台",
				restartHint:
					"配置已写入 .env.local，重启服务后对所有功能（登录、同步等）生效",
			},
			200,
			headers,
		);
	} catch (error) {
		console.error(
			"[Setup] 初始化异常:",
			error instanceof Error ? error.stack : error,
		);
		return json({ success: false, message: "初始化失败，请稍后重试" }, 500);
	}
}
